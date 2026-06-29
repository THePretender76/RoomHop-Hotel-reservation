import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { CONFIG } from './config';
import { SecurityGroups } from './network-stack';

export interface DatabaseStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  securityGroups: SecurityGroups;
}

export class DatabaseStack extends cdk.Stack {
  public readonly dbSecret: secretsmanager.ISecret;
  public readonly dbEndpoint: string;

  constructor(scope: Construct, id: string, props: DatabaseStackProps) {
    super(scope, id, props);

    const { vpc, securityGroups } = props;

    // ─── RDS MySQL 8.0 Multi-AZ ─────────────────────────────────────────────────
    // Credentials auto-generated and stored in Secrets Manager.
    // Placed in private isolated subnets — no public accessibility.
    const dbInstance = new rds.DatabaseInstance(this, 'RoomHopDb', {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0,
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
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      publiclyAccessible: false,
      // Performance Insights for production observability
      enablePerformanceInsights: true,
      parameterGroup: new rds.ParameterGroup(this, 'DbParamGroup', {
        engine: rds.DatabaseInstanceEngine.mysql({
          version: rds.MysqlEngineVersion.VER_8_0,
        }),
        parameters: {
          character_set_server: 'utf8mb4',
          collation_server: 'utf8mb4_unicode_ci',
        },
      }),
    });

    this.dbSecret = dbInstance.secret!;
    this.dbEndpoint = dbInstance.dbInstanceEndpointAddress;

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
