import * as cdk from 'aws-cdk-lib';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as accessanalyzer from 'aws-cdk-lib/aws-accessanalyzer';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dms from 'aws-cdk-lib/aws-dms';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { CONFIG } from './config';
import {
  NamedEcsService,
  NamedFunction,
  NamedQueue,
  RoomHopOperationsDashboard,
} from './constructs/roomhop-operations-dashboard';

export interface ObservabilityStackProps extends cdk.StackProps {
  readonly alb: elbv2.IApplicationLoadBalancer;
  readonly cluster: ecs.ICluster;
  readonly ecsServices: NamedEcsService[];
  readonly database: rds.IDatabaseInstance;
  readonly searchDomain: opensearch.IDomain;
  readonly queues: NamedQueue[];
  readonly deadLetterQueues: NamedQueue[];
  readonly functions: NamedFunction[];
  readonly dlqAlarms: cloudwatch.IAlarm[];
  readonly replicationTask: dms.CfnReplicationTask;
  readonly replicationInstance: dms.CfnReplicationInstance;
}

export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: ObservabilityStackProps) {
    super(scope, id, props);

    // ─── CloudTrail S3 Bucket ────────────────────────────────────────────────────
    // Dedicated bucket for CloudTrail logs — separate from app buckets
    const trailBucket = new s3.Bucket(this, 'CloudTrailBucket', {
      bucketName: `${CONFIG.projectName}-cloudtrail-${cdk.Aws.ACCOUNT_ID}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          // Keep trail logs for 90 days then expire
          expiration: cdk.Duration.days(90),
        },
      ],
    });

    // ─── CloudTrail Log Group ────────────────────────────────────────────────────
    // Sends trail events to CloudWatch Logs for real-time querying
    const trailLogGroup = new logs.LogGroup(this, 'CloudTrailLogGroup', {
      logGroupName: `/aws/cloudtrail/${CONFIG.projectName}`,
      retention: logs.RetentionDays.THREE_MONTHS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // ─── CloudTrail Trail ────────────────────────────────────────────────────────
    // Records all management events (API calls) across the account.
    // Management events are free — data events (S3 object reads/writes) are not enabled.
    new cloudtrail.Trail(this, 'RoomHopTrail', {
      trailName: `${CONFIG.projectName}-trail`,
      bucket: trailBucket,
      cloudWatchLogGroup: trailLogGroup,
      sendToCloudWatchLogs: true,
      includeGlobalServiceEvents: true,  // captures IAM, STS events
      isMultiRegionTrail: false,          // single region — us-east-1 only
      enableFileValidation: true,         // detects if log files are tampered
      managementEvents: cloudtrail.ReadWriteType.ALL,
    });

    // ─── IAM Access Analyzer ────────────────────────────────────────────────────
    // Continuously analyzes resource policies (S3, IAM roles, KMS, SQS, Lambda)
    // and flags any that grant access to external principals outside your account.
    new accessanalyzer.CfnAnalyzer(this, 'RoomHopAccessAnalyzer', {
      analyzerName: `${CONFIG.projectName}-access-analyzer`,
      type: 'ACCOUNT',  // analyzes all resources in this account
    });

    new RoomHopOperationsDashboard(this, 'OperationsDashboard', {
      alb: props.alb,
      cluster: props.cluster,
      ecsServices: props.ecsServices,
      database: props.database,
      searchDomain: props.searchDomain,
      queues: props.queues,
      deadLetterQueues: props.deadLetterQueues,
      functions: props.functions,
      dlqAlarms: props.dlqAlarms,
      replicationTask: props.replicationTask,
      replicationInstance: props.replicationInstance,
    });

    // ─── Outputs ────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'CloudTrailBucketName', {
      value: trailBucket.bucketName,
      description: 'S3 bucket storing CloudTrail logs',
    });

    new cdk.CfnOutput(this, 'CloudTrailLogGroupName', {
      value: trailLogGroup.logGroupName,
      description: 'CloudWatch Log Group for CloudTrail events',
    });
  }
}
