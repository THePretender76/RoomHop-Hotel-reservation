import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as path from 'path';
import { Construct } from 'constructs';
import { CONFIG } from './config';
import { SecurityGroups } from './network-stack';

export interface DatabaseStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  securityGroups: SecurityGroups;
}

export class DatabaseStack extends cdk.Stack {
  public readonly database: rds.DatabaseInstance;
  public readonly dbSecret: secretsmanager.ISecret;
  public readonly dbEndpoint: string;
  public readonly migrationLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { vpc, securityGroups } = props;

    // ─── RDS MySQL 8.0 Single-AZ (intentional project constraint) ──────────
    // Credentials auto-generated and stored in Secrets Manager.
    // Placed in private isolated subnets — no public accessibility.
    this.database = new rds.DatabaseInstance(this, 'RoomHopDb', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0_46,
      }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MEDIUM
      ),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [securityGroups.rdsSg],
      multiAz: false,
      allocatedStorage: 50,
      maxAllocatedStorage: 200,
      storageEncrypted: true,
      databaseName: CONFIG.rds.databaseName,
      port: CONFIG.rds.port,
      credentials: rds.Credentials.fromGeneratedSecret('roomhop_admin', {
        secretName: `${CONFIG.projectName}/rds/credentials`,
      }),
      backupRetention: cdk.Duration.days(7),
      deletionProtection: false,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      publiclyAccessible: false,
      // Performance Insights for production observability
      enablePerformanceInsights: true,
      parameterGroup: new rds.ParameterGroup(this, 'DbParamGroup', {
        engine: rds.DatabaseInstanceEngine.mysql({
          version: rds.MysqlEngineVersion.VER_8_0_46,
        }),
        parameters: {
          character_set_server: 'utf8mb4',
          collation_server: 'utf8mb4_unicode_ci',
          binlog_format: 'ROW',
          binlog_row_image: 'FULL',
        },
      }),
    });

    this.dbSecret = this.database.secret!;
    this.dbEndpoint = this.database.dbInstanceEndpointAddress;

    // ─── Database Migration Lambda ──────────────────────────────────────────────
    // Runs migration SQL on stack CREATE. Uses a Custom Resource so it executes
    // automatically during deployment without manual intervention.
    const migrationLogGroup = new logs.LogGroup(this, 'DbMigrationLogs', {
      // Preserve any orphaned conventional Lambda logs instead of deleting
      // them merely to let CloudFormation create this managed log group.
      logGroupName: `/${CONFIG.projectName}/lambda/db-migration`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    this.migrationLambda = new lambda.Function(this, 'DbMigrationFn', {
      functionName: `${CONFIG.projectName}-db-migration`,
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../services/lambda/db-migration')),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [securityGroups.lambdaSg],
      environment: {
        DB_SECRET_ARN: this.database.secret!.secretArn,
        DB_NAME: CONFIG.rds.databaseName,
      },
      logGroup: migrationLogGroup,
    });

    // Grant the migration Lambda access to read the DB secret
    this.database.secret!.grantRead(this.migrationLambda);

    // Allow the Lambda SG to connect to RDS on MySQL port
    securityGroups.rdsSg.addIngressRule(
      securityGroups.lambdaSg,
      ec2.Port.tcp(CONFIG.rds.port),
      'Allow MySQL from migration Lambda'
    );

    // Custom Resource Provider
    const migrationProviderLogs = new logs.LogGroup(this, 'DbMigrationProviderLogs', {
      logGroupName: `/aws/lambda/${CONFIG.projectName}-db-migration-provider`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const migrationProvider = new cr.Provider(this, 'DbMigrationProvider', {
      onEventHandler: this.migrationLambda,
      logGroup: migrationProviderLogs,
    });

    // Custom Resource — triggers the migration Lambda on stack CREATE
    const migrationResource = new cdk.CustomResource(this, 'DbMigration', {
      serviceToken: migrationProvider.serviceToken,
      properties: {
        // Change this value to force re-run of migration on next deploy
        migrationVersion: '7',
      },
    });

    // Ensure migration runs AFTER RDS is ready
    migrationResource.node.addDependency(this.database);

    // ─── Outputs ────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'DbEndpoint', {
      value: this.dbEndpoint,
      description: 'RDS MySQL endpoint address',
    });

    new cdk.CfnOutput(this, 'DbSecretArn', {
      value: this.dbSecret.secretArn,
      description: 'ARN of the database credentials secret',
    });
  }
}
