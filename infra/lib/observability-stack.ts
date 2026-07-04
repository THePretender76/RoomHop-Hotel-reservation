import * as cdk from 'aws-cdk-lib';
import * as cloudtrail from 'aws-cdk-lib/aws-cloudtrail';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as accessanalyzer from 'aws-cdk-lib/aws-accessanalyzer';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { CONFIG } from './config';

export class ObservabilityStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
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
