import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
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

export class EventsStack extends cdk.Stack {
  public readonly analyticsBucket: s3.Bucket;
  public readonly eventBus: events.EventBus;
  public readonly notificationQueue: sqs.Queue;
  public readonly analyticsQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const senderEmail = new cdk.CfnParameter(this, 'SesSenderEmail', {
      type: 'String',
      description: 'A verified Amazon SES sender identity used for RoomHop emails',
      allowedPattern: '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$',
      constraintDescription: 'Enter a valid email address that is verified in SES.',
    });

    this.analyticsBucket = new s3.Bucket(this, 'AnalyticsBucket', {
      bucketName: `${CONFIG.s3.analyticsBucket}-${cdk.Aws.ACCOUNT_ID}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [{
        transitions: [{
          storageClass: s3.StorageClass.GLACIER,
          transitionAfter: cdk.Duration.days(90),
        }],
      }],
    });

    this.eventBus = new events.EventBus(this, 'RoomHopEventBus', {
      eventBusName: `${CONFIG.projectName}-events`,
    });
    this.eventBus.archive('EventArchive', {
      archiveName: `${CONFIG.projectName}-event-archive`,
      description: 'Replayable reservation and partner workflow events',
      eventPattern: { source: ['roomhop.reservation', 'roomhop.partner'] },
      retention: cdk.Duration.days(365),
    });

    const notificationDlq = new sqs.Queue(this, 'NotificationDlq', {
      queueName: `${CONFIG.projectName}-notification-dlq`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    });
    this.notificationQueue = new sqs.Queue(this, 'NotificationQueue', {
      queueName: `${CONFIG.projectName}-notification-queue`,
      visibilityTimeout: cdk.Duration.seconds(90),
      retentionPeriod: cdk.Duration.days(7),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      deadLetterQueue: { queue: notificationDlq, maxReceiveCount: 3 },
    });

    const analyticsDlq = new sqs.Queue(this, 'AnalyticsDlq', {
      queueName: `${CONFIG.projectName}-analytics-dlq`,
      retentionPeriod: cdk.Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
    });
    this.analyticsQueue = new sqs.Queue(this, 'AnalyticsQueue', {
      queueName: `${CONFIG.projectName}-analytics-queue`,
      visibilityTimeout: cdk.Duration.seconds(180),
      retentionPeriod: cdk.Duration.days(7),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      enforceSSL: true,
      deadLetterQueue: { queue: analyticsDlq, maxReceiveCount: 3 },
    });

    const bookingRule = new events.Rule(this, 'BookingEventsRule', {
      eventBus: this.eventBus,
      ruleName: `${CONFIG.projectName}-booking-events`,
      eventPattern: {
        source: ['roomhop.reservation'],
        detailType: ['BookingConfirmed', 'BookingCancelled'],
      },
    });
    bookingRule.addTarget(new eventsTargets.SqsQueue(this.notificationQueue));
    bookingRule.addTarget(new eventsTargets.SqsQueue(this.analyticsQueue));

    const partnerRule = new events.Rule(this, 'PartnerEventsRule', {
      eventBus: this.eventBus,
      ruleName: `${CONFIG.projectName}-partner-events`,
      eventPattern: {
        source: ['roomhop.partner'],
        detailType: ['PartnerApplicationSubmitted', 'PartnerApplicationReviewed'],
      },
    });
    partnerRule.addTarget(new eventsTargets.SqsQueue(this.notificationQueue));

    const notificationLogGroup = new logs.LogGroup(this, 'NotificationLogGroup', {
      // Keep CDK-owned logs separate from conventional Lambda groups that may
      // remain after an earlier deployment.
      logGroupName: `/${CONFIG.projectName}/lambda/notification-handler`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const notificationLambda = new lambda.Function(this, 'NotificationHandler', {
      functionName: `${CONFIG.projectName}-notification-handler`,
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../services/lambda/notification-handler')),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        AWS_REGION_OVERRIDE: CONFIG.region,
        SENDER_EMAIL: senderEmail.valueAsString,
      },
      logGroup: notificationLogGroup,
    });
    notificationLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: [cdk.Stack.of(this).formatArn({
        service: 'ses',
        resource: 'identity',
        resourceName: senderEmail.valueAsString,
      })],
    }));
    notificationLambda.addEventSource(new lambdaEventSources.SqsEventSource(this.notificationQueue, {
      batchSize: 10,
      maxBatchingWindow: cdk.Duration.seconds(5),
      reportBatchItemFailures: true,
    }));

    const analyticsLogGroup = new logs.LogGroup(this, 'AnalyticsLogGroup', {
      logGroupName: `/${CONFIG.projectName}/lambda/analytics-handler`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const analyticsLambda = new lambda.Function(this, 'AnalyticsHandler', {
      functionName: `${CONFIG.projectName}-analytics-handler`,
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../services/lambda/analytics-handler')),
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: {
        ANALYTICS_BUCKET: this.analyticsBucket.bucketName,
        AWS_REGION_OVERRIDE: CONFIG.region,
      },
      logGroup: analyticsLogGroup,
    });
    this.analyticsBucket.grantWrite(analyticsLambda);
    analyticsLambda.addEventSource(new lambdaEventSources.SqsEventSource(this.analyticsQueue, {
      batchSize: 10,
      maxBatchingWindow: cdk.Duration.seconds(30),
      reportBatchItemFailures: true,
    }));

    new cdk.CfnOutput(this, 'EventBusName', { value: this.eventBus.eventBusName });
    new cdk.CfnOutput(this, 'NotificationQueueUrl', { value: this.notificationQueue.queueUrl });
    new cdk.CfnOutput(this, 'AnalyticsQueueUrl', { value: this.analyticsQueue.queueUrl });
    new cdk.CfnOutput(this, 'AnalyticsBucketName', { value: this.analyticsBucket.bucketName });
  }
}
