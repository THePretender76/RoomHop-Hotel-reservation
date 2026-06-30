import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as glue from 'aws-cdk-lib/aws-glue';
import { Construct } from 'constructs';
import { CONFIG } from './config';

export interface AnalyticsStackProps extends cdk.StackProps {
  analyticsBucket: s3.Bucket;
}

export class AnalyticsStack extends cdk.Stack {
  public readonly athenaWorkgroup: athena.CfnWorkGroup;

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

    // ─── Glue Table: Reservations ───────────────────────────────────────────────
    // Points to S3 analytics bucket with Hive-style partitioning (year/month/day).
    new glue.CfnTable(this, 'ReservationsTable', {
      catalogId: cdk.Aws.ACCOUNT_ID,
      databaseName: glueDatabase.ref,
      tableInput: {
        name: 'reservations',
        description: 'Reservation events from EventBridge',
        tableType: 'EXTERNAL_TABLE',
        parameters: {
          'classification': 'json',
          'projection.enabled': 'true',
          'projection.year.type': 'integer',
          'projection.year.range': '2024,2030',
          'projection.month.type': 'integer',
          'projection.month.range': '1,12',
          'projection.month.digits': '2',
          'projection.day.type': 'integer',
          'projection.day.range': '1,31',
          'projection.day.digits': '2',
          'storage.location.template': `s3://${analyticsBucket.bucketName}/reservations/year=\${year}/month=\${month}/day=\${day}/`,
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
