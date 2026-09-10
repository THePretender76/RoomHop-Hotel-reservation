import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as schedulerTargets from 'aws-cdk-lib/aws-scheduler-targets';
import { Construct } from 'constructs';
import { CONFIG } from './config';

export interface AnalyticsStackProps extends cdk.StackProps {
  analyticsBucket: s3.Bucket;
}

export class AnalyticsStack extends cdk.Stack {
  public readonly athenaWorkgroup: athena.CfnWorkGroup;
  public readonly athenaResultsBucket: s3.Bucket;
  public readonly glueDatabaseName: string;
  public readonly reservationCrawler: glue.CfnCrawler;

  constructor(scope: Construct, id: string, props: AnalyticsStackProps) {
    super(scope, id, props);

    const { analyticsBucket } = props;

    // ─── Athena Results Bucket ──────────────────────────────────────────────────
    const athenaResultsBucket = new s3.Bucket(this, 'AthenaResultsBucket', {
      bucketName: `${CONFIG.projectName}-athena-results-${cdk.Aws.ACCOUNT_ID}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      lifecycleRules: [
        {
          // Auto-delete query results after 30 days
          expiration: cdk.Duration.days(30),
        },
      ],
    });
    this.athenaResultsBucket = athenaResultsBucket;

    // ─── Athena Workgroup ───────────────────────────────────────────────────────
    this.athenaWorkgroup = new athena.CfnWorkGroup(this, 'RoomHopWorkgroup', {
      name: `${CONFIG.projectName}-analytics`,
      description: 'RoomHop analytics workgroup for reservation data queries',
      state: 'ENABLED',
      workGroupConfiguration: {
        resultConfiguration: {
          outputLocation: `s3://${athenaResultsBucket.bucketName}/query-results/`,
          encryptionConfiguration: {
            encryptionOption: 'SSE_S3',
          },
        },
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: true,
        bytesScannedCutoffPerQuery: 1073741824, // 1 GB scan limit
        engineVersion: {
          selectedEngineVersion: 'Athena engine version 3',
        },
      },
    });

    // ─── Glue Database ──────────────────────────────────────────────────────────
    const glueDatabase = new glue.CfnDatabase(this, 'RoomHopGlueDb', {
      catalogId: cdk.Aws.ACCOUNT_ID,
      databaseInput: {
        name: `${CONFIG.projectName}_analytics`,
        description: 'RoomHop analytics database for reservation event data',
      },
    });
    this.glueDatabaseName = glueDatabase.ref;

    // ─── Glue Table: Reservations ───────────────────────────────────────────────
    // Points to S3 analytics bucket with Hive-style partitioning (year/month/day).
    const reservationsTable = new glue.CfnTable(this, 'ReservationsTable', {
      catalogId: cdk.Aws.ACCOUNT_ID,
      databaseName: glueDatabase.ref,
      tableInput: {
        name: 'reservations',
        description: 'Reservation events from EventBridge',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          'classification': 'json',
          // Athena must use the partitions registered by the crawler. Projection
          // would make it ignore them. Run the first crawl before querying.
          'projection.enabled': 'false',
        },
        storageDescriptor: {
          location: `s3://${analyticsBucket.bucketName}/reservations/`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
            parameters: {
              'serialization.format': '1',
            },
          },
          columns: [
            { name: 'eventType', type: 'string' },
            { name: 'reservationId', type: 'string' },
            { name: 'guestEmail', type: 'string' },
            { name: 'guestName', type: 'string' },
            { name: 'hotelId', type: 'string' },
            { name: 'hotelName', type: 'string' },
            { name: 'roomType', type: 'string' },
            { name: 'checkIn', type: 'string' },
            { name: 'checkOut', type: 'string' },
            { name: 'totalAmount', type: 'double' },
            { name: 'currency', type: 'string' },
            { name: 'timestamp', type: 'string' },
          ],
        },
        partitionKeys: [
          { name: 'year', type: 'string' },
          { name: 'month', type: 'string' },
          { name: 'day', type: 'string' },
        ],
      },
    });

    const crawlerName = `${CONFIG.projectName}-reservation-crawler`;
    const crawlerRole = new iam.Role(this, 'ReservationCrawlerRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      description: 'Read reservation JSON and maintain its existing Glue table partitions',
    });
    crawlerRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetBucketLocation'],
      resources: [analyticsBucket.bucketArn],
    }));
    crawlerRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:ListBucket'],
      resources: [analyticsBucket.bucketArn],
      conditions: { StringLike: { 's3:prefix': ['reservations', 'reservations/*'] } },
    }));
    crawlerRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [analyticsBucket.arnForObjects('reservations/*')],
    }));
    crawlerRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'glue:GetDatabase', 'glue:GetTable', 'glue:GetTables',
        'glue:GetPartition', 'glue:GetPartitions', 'glue:BatchGetPartition',
        'glue:UpdateTable', 'glue:CreatePartition', 'glue:BatchCreatePartition',
        'glue:UpdatePartition', 'glue:BatchUpdatePartition',
      ],
      resources: [
        this.formatArn({ service: 'glue', resource: 'catalog' }),
        this.formatArn({ service: 'glue', resource: 'database', resourceName: glueDatabase.ref }),
        this.formatArn({ service: 'glue', resource: 'table', resourceName: `${glueDatabase.ref}/${reservationsTable.ref}` }),
      ],
    }));
    // Glue owns this shared service log group; don't create a conflicting group
    // if another crawler already uses it. No S3 writes or VPC permissions needed.
    const crawlerLogGroupArn = this.formatArn({
      service: 'logs', resource: 'log-group', resourceName: '/aws-glue/crawlers',
      arnFormat: cdk.ArnFormat.COLON_RESOURCE_NAME,
    });
    crawlerRole.addToPolicy(new iam.PolicyStatement({
      actions: ['logs:CreateLogGroup'],
      resources: [`${crawlerLogGroupArn}:*`],
    }));
    crawlerRole.addToPolicy(new iam.PolicyStatement({
      actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
      resources: [`${crawlerLogGroupArn}:log-stream:${crawlerName}*`],
    }));

    this.reservationCrawler = new glue.CfnCrawler(this, 'RoomHopReservationCrawler', {
      name: crawlerName,
      description: 'Discover daily reservation partitions in the existing analytics S3 location',
      role: crawlerRole.roleArn,
      databaseName: glueDatabase.ref,
      // A catalog target crawls the table's S3 location, pins its name, and
      // prevents new tables per date folder. CloudFormation owns table creation.
      targets: { catalogTargets: [{ databaseName: glueDatabase.ref, tables: [reservationsTable.ref] }] },
      schemaChangePolicy: { updateBehavior: 'LOG', deleteBehavior: 'LOG' },
      recrawlPolicy: { recrawlBehavior: 'CRAWL_EVERYTHING' },
      configuration: JSON.stringify({
        Version: 1.0,
        CrawlerOutput: { Partitions: { AddOrUpdateBehavior: 'InheritFromTable' } },
      }),
    });
    // The crawler must not become runnable before its scoped policy is attached.
    this.reservationCrawler.node.addDependency(crawlerRole);
    const crawlerArn = this.formatArn({
      service: 'glue', resource: 'crawler', resourceName: this.reservationCrawler.ref,
    });
    const schedulerRole = new iam.Role(this, 'ReservationCrawlerSchedulerRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com', {
        conditions: {
          StringEquals: {
            'aws:SourceAccount': this.account,
            // Scheduler supplies its group ARN, not an individual schedule ARN.
            'aws:SourceArn': this.formatArn({ service: 'scheduler', resource: 'schedule-group', resourceName: 'default' }),
          },
        },
      }),
    });
    const crawlerSchedule = new scheduler.Schedule(this, 'ReservationCrawlerSchedule', {
      scheduleName: `${CONFIG.projectName}-reservation-crawler-hourly`,
      description: 'Refresh reservation catalog partitions once per hour',
      schedule: scheduler.ScheduleExpression.rate(cdk.Duration.hours(1)),
      timeWindow: scheduler.TimeWindow.off(),
      target: new schedulerTargets.Universal({
        role: schedulerRole,
        service: 'glue',
        action: 'startCrawler',
        input: scheduler.ScheduleTargetInput.fromObject({ Name: this.reservationCrawler.ref }),
        policyStatements: [new iam.PolicyStatement({ actions: ['glue:StartCrawler'], resources: [crawlerArn] })],
        // Bound retries within this hour; Glue rejects overlapping crawler runs.
        retryAttempts: 1,
        maxEventAge: cdk.Duration.minutes(15),
      }),
    });
    crawlerSchedule.node.addDependency(schedulerRole);

    new cdk.CfnOutput(this, 'ReservationCrawlerName', { value: this.reservationCrawler.ref });
    new cdk.CfnOutput(this, 'ReservationCrawlerScheduleName', { value: crawlerSchedule.scheduleName });
    new cdk.CfnOutput(this, 'ReservationAnalyticsLocation', {
      value: `s3://${analyticsBucket.bucketName}/reservations/`,
    });
    new cdk.CfnOutput(this, 'ReservationsTableName', { value: reservationsTable.ref });

    // ─── Outputs ────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'AthenaWorkgroupName', {
      value: this.athenaWorkgroup.name,
      description: 'Athena workgroup for BI queries',
    });

    new cdk.CfnOutput(this, 'GlueDatabaseName', {
      value: glueDatabase.ref,
      description: 'Glue database name',
    });

    new cdk.CfnOutput(this, 'AthenaResultsBucketName', {
      value: athenaResultsBucket.bucketName,
      description: 'S3 bucket for Athena query results',
    });
  }
}
