import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { CONFIG } from './config';
import { SecurityGroups } from './network-stack';

export interface EventsStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  securityGroups: SecurityGroups;
}

export class EventsStack extends cdk.Stack {
  public readonly analyticsBucket: s3.Bucket;
  public readonly eventBus: events.EventBus;

  constructor(scope: Construct, id: string, props: EventsStackProps) {
    super(scope, id, props);

    const { vpc, securityGroups } = props;

    // â”€â”€â”€ Analytics Data Lake Bucket â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.analyticsBucket = new s3.Bucket(this, 'AnalyticsBucket', {
      bucketName: `${CONFIG.s3.analyticsBucket}-${cdk.Aws.ACCOUNT_ID}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          // Move old analytics data to Glacier after 90 days
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(90),
            },
          ],
        },
      ],
    });

    // â”€â”€â”€ EventBridge Custom Event Bus â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    this.eventBus = new events.EventBus(this, 'RoomHopEventBus', {
      eventBusName: `${CONFIG.projectName}-events`,
    });

    // Archive all events for replay capability
    this.eventBus.archive('EventArchive', {
      archiveName: `${CONFIG.projectName}-event-archive`,
      description: 'Archive of all RoomHop booking events',
      eventPattern: {
        source: ['roomhop.reservation'],
      },
      retention: cdk.Duration.days(365),
    });

    // â”€â”€â”€ SQS Queues â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    // Notification DLQ
    const notificationDlq = new sqs.Queue(this, 'NotificationDlq', {
      queueName: `${CONFIG.projectName}-notification-dlq`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // Notification Queue â€” triggers email notifications via SES
    const notificationQueue = new sqs.Queue(this, 'NotificationQueue', {
      queueName: `${CONFIG.projectName}-notification-queue`,
      visibilityTimeout: cdk.Duration.seconds(60),
      retentionPeriod: cdk.Duration.days(7),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: notificationDlq,
        maxReceiveCount: 3,
      },
    });

    // Analytics DLQ
    const analyticsDlq = new sqs.Queue(this, 'AnalyticsDlq', {
      queueName: `${CONFIG.projectName}-analytics-dlq`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // Analytics Queue â€” triggers S3 writes for BI
    const analyticsQueue = new sqs.Queue(this, 'AnalyticsQueue', {
      queueName: `${CONFIG.projectName}-analytics-queue`,
      visibilityTimeout: cdk.Duration.seconds(120),
      retentionPeriod: cdk.Duration.days(7),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      deadLetterQueue: {
        queue: analyticsDlq,
        maxReceiveCount: 3,
      },
    });

    // â”€â”€â”€ EventBridge Rule â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Matches booking events and fans out to both queues.
    const bookingRule = new events.Rule(this, 'BookingEventsRule', {
      eventBus: this.eventBus,
      ruleName: `${CONFIG.projectName}-booking-events`,
      description: 'Routes booking confirmation and cancellation events',
      eventPattern: {
        source: ['roomhop.reservation'],
        detailType: ['BookingConfirmed', 'BookingCancelled'],
      },
    });

    bookingRule.addTarget(new eventsTargets.SqsQueue(notificationQueue));
    bookingRule.addTarget(new eventsTargets.SqsQueue(analyticsQueue));

    // â”€â”€â”€ Lambda: Notification Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Sends booking confirmation/cancellation emails via SES.
    // Code is in services/lambda/notification-handler/
    const notificationLambda = new lambda.Function(this, 'NotificationHandler', {
      functionName: `${CONFIG.projectName}-notification-handler`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../services/lambda/notification-handler'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [securityGroups.lambdaSg],
      environment: {
        AWS_REGION_OVERRIDE: CONFIG.region,
        SENDER_EMAIL: 'thenewpretender@gmail.com',
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Grant SES send permissions
    notificationLambda.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
        resources: ['*'],
      })
    );

    // Wire SQS â†’ Lambda
    notificationLambda.addEventSource(
      new lambdaEventSources.SqsEventSource(notificationQueue, {
        batchSize: 10,
        maxBatchingWindow: cdk.Duration.seconds(5),
      })
    );

    // â”€â”€â”€ Lambda: Analytics Handler â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // Writes booking event data to S3 as JSON for Athena queries.
    // Code is in services/lambda/analytics-handler/
    const analyticsLambda = new lambda.Function(this, 'AnalyticsHandler', {
      functionName: `${CONFIG.projectName}-analytics-handler`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('../services/lambda/analytics-handler'),
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [securityGroups.lambdaSg],
      environment: {
        ANALYTICS_BUCKET: this.analyticsBucket.bucketName,
        AWS_REGION_OVERRIDE: CONFIG.region,
      },
      logRetention: logs.RetentionDays.ONE_MONTH,
    });

    // Grant S3 write access to analytics bucket
    this.analyticsBucket.grantWrite(analyticsLambda);

    // Wire SQS â†’ Lambda
    analyticsLambda.addEventSource(
      new lambdaEventSources.SqsEventSource(analyticsQueue, {
        batchSize: 10,
        maxBatchingWindow: cdk.Duration.seconds(30),
      })
    );

    // â”€â”€â”€ Outputs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    new cdk.CfnOutput(this, 'EventBusName', {
      value: this.eventBus.eventBusName,
      description: 'Custom EventBridge event bus name',
    });

    new cdk.CfnOutput(this, 'NotificationQueueUrl', {
      value: notificationQueue.queueUrl,
      description: 'SQS notification queue URL',
    });

    new cdk.CfnOutput(this, 'AnalyticsQueueUrl', {
      value: analyticsQueue.queueUrl,
      description: 'SQS analytics queue URL',
    });

    new cdk.CfnOutput(this, 'AnalyticsBucketName', {
      value: this.analyticsBucket.bucketName,
      description: 'S3 analytics data lake bucket',
    });
  }
}
