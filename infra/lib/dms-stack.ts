import * as cdk from 'aws-cdk-lib';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as dms from 'aws-cdk-lib/aws-dms';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as fs from 'fs';
import * as path from 'path';
import { Construct } from 'constructs';
import { CONFIG } from './config';
import { SecurityGroups } from './network-stack';

export interface DmsStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  securityGroups: SecurityGroups;
  dbSecret: secretsmanager.ISecret;
  opensearchEndpoint: string;
  opensearchArn: string;
}

export class DmsStack extends cdk.Stack {
  public readonly replicationInstance: dms.CfnReplicationInstance;
  public readonly replicationTask: dms.CfnReplicationTask;
  public readonly replicationTaskArn: string;

  constructor(scope: Construct, id: string, props: DmsStackProps) {
    super(scope, id, props);

    // DMS uses these account-level service roles with fixed names. Reuse the
    // standard roles when they already exist instead of trying to create a
    // second CloudFormation-owned copy with the same physical name.
    const dmsVpcRole = iam.Role.fromRoleName(this, 'DmsVpcRole', 'dms-vpc-role');
    const dmsLogsRole = iam.Role.fromRoleName(
      this,
      'DmsCloudWatchLogsRole',
      'dms-cloudwatch-logs-role'
    );

    const secretAccessRole = new iam.Role(this, 'DmsSecretAccessRole', {
      // Secrets-backed endpoints require the regional DMS service principal.
      assumedBy: new iam.ServicePrincipal(`dms.${CONFIG.region}.amazonaws.com`),
    });
    props.dbSecret.grantRead(secretAccessRole);

    const openSearchRole = new iam.Role(this, 'DmsOpenSearchRole', {
      assumedBy: new iam.ServicePrincipal('dms.amazonaws.com'),
    });
    openSearchRole.addToPolicy(new iam.PolicyStatement({
      actions: ['es:ESHttpGet', 'es:ESHttpHead', 'es:ESHttpPost', 'es:ESHttpPut', 'es:ESHttpDelete'],
      resources: [`${props.opensearchArn}/*`],
    }));

    const dmsSg = new ec2.SecurityGroup(this, 'DmsSecurityGroup', {
      vpc: props.vpc,
      description: 'Network access for the RDS to OpenSearch DMS replication instance',
      allowAllOutbound: true,
    });
    new ec2.CfnSecurityGroupIngress(this, 'DmsToRdsIngress', {
      groupId: props.securityGroups.rdsSg.securityGroupId,
      sourceSecurityGroupId: dmsSg.securityGroupId,
      ipProtocol: 'tcp',
      fromPort: CONFIG.rds.port,
      toPort: CONFIG.rds.port,
      description: 'Allow DMS CDC reads from RDS',
    });
    new ec2.CfnSecurityGroupIngress(this, 'DmsToOpenSearchIngress', {
      groupId: props.securityGroups.opensearchSg.securityGroupId,
      sourceSecurityGroupId: dmsSg.securityGroupId,
      ipProtocol: 'tcp',
      fromPort: 443,
      toPort: 443,
      description: 'Allow DMS writes to OpenSearch',
    });

    const subnetGroup = new dms.CfnReplicationSubnetGroup(this, 'DmsSubnetGroup', {
      replicationSubnetGroupIdentifier: `${CONFIG.projectName}-dms-subnets`,
      replicationSubnetGroupDescription: 'Two-AZ private subnet group for RoomHop DMS',
      subnetIds: props.vpc.selectSubnets({
        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
      }).subnetIds,
    });

    this.replicationInstance = new dms.CfnReplicationInstance(this, 'DmsReplicationInstance', {
      replicationInstanceIdentifier: `${CONFIG.projectName}-dms-instance`,
      replicationInstanceClass: CONFIG.dms.instanceClass,
      allocatedStorage: CONFIG.dms.allocatedStorage,
      vpcSecurityGroupIds: [dmsSg.securityGroupId],
      replicationSubnetGroupIdentifier: subnetGroup.ref,
      multiAz: false,
      publiclyAccessible: false,
      autoMinorVersionUpgrade: true,
    });
    this.replicationInstance.addResourceDependency(subnetGroup);
    this.replicationInstance.node.addDependency(dmsVpcRole);

    const rdsCaCertificate = new dms.CfnCertificate(this, 'RdsCaCertificate', {
      certificateIdentifier: `${CONFIG.projectName}-rds-us-east-1-ca-rsa2048-g1`,
      certificatePem: fs.readFileSync(
        path.join(__dirname, '../certificates/rds-us-east-1-ca-rsa2048-g1.pem'),
        'utf8'
      ),
    });

    const sourceEndpoint = new dms.CfnEndpoint(this, 'RdsSourceEndpoint', {
      endpointIdentifier: `${CONFIG.projectName}-mysql-source`,
      endpointType: 'source',
      engineName: 'mysql',
      sslMode: 'verify-full',
      certificateArn: rdsCaCertificate.attrCertificateArn,
      mySqlSettings: {
        secretsManagerSecretId: props.dbSecret.secretArn,
        secretsManagerAccessRoleArn: secretAccessRole.roleArn,
        eventsPollInterval: 5,
      },
    });
    sourceEndpoint.addResourceDependency(rdsCaCertificate);

    const targetEndpoint = new dms.CfnEndpoint(this, 'OpenSearchTargetEndpoint', {
      endpointIdentifier: `${CONFIG.projectName}-opensearch-target`,
      endpointType: 'target',
      engineName: 'opensearch',
      extraConnectionAttributes: 'useNewMappingType=true',
      elasticsearchSettings: {
        endpointUri: `https://${props.opensearchEndpoint}`,
        serviceAccessRoleArn: openSearchRole.roleArn,
        errorRetryDuration: 300,
        fullLoadErrorPercentage: 1,
      },
    });

    const tables = ['hotel', 'room_type', 'room_type_rate', 'room_type_inventory', 'hotel_images'];
    const tableMappings = {
      rules: tables.map((tableName, index) => ({
        'rule-type': 'selection',
        'rule-id': String(index + 1),
        'rule-name': `include-${tableName.replace(/_/g, '-')}`,
        'object-locator': {
          'schema-name': CONFIG.rds.databaseName,
          'table-name': tableName,
        },
        'rule-action': 'include',
      })),
    };

    this.replicationTask = new dms.CfnReplicationTask(this, 'FullLoadAndCdcTask', {
      replicationTaskIdentifier: `${CONFIG.projectName}-search-cdc`,
      replicationInstanceArn: this.replicationInstance.ref,
      sourceEndpointArn: sourceEndpoint.ref,
      targetEndpointArn: targetEndpoint.ref,
      migrationType: 'full-load-and-cdc',
      tableMappings: JSON.stringify(tableMappings),
      replicationTaskSettings: JSON.stringify({
        TargetMetadata: {
          SupportLobs: false,
          FullLobMode: false,
          LimitedSizeLobMode: false,
          ParallelLoadThreads: 2,
          ParallelLoadBufferSize: 100,
          ParallelApplyThreads: 2,
          ParallelApplyBufferSize: 100,
        },
        FullLoadSettings: {
          TargetTablePrepMode: 'DROP_AND_CREATE',
          MaxFullLoadSubTasks: 5,
        },
        Logging: {
          EnableLogging: true,
        },
      }),
    });
    this.replicationTask.addResourceDependency(this.replicationInstance);
    this.replicationTask.addResourceDependency(sourceEndpoint);
    this.replicationTask.addResourceDependency(targetEndpoint);
    this.replicationTask.node.addDependency(dmsLogsRole);

    // CloudFormation creates DMS tasks stopped; start the initial full-load + CDC automatically.
    const starter = new cr.AwsCustomResource(this, 'StartReplicationTask', {
      onCreate: {
        service: 'DMS',
        action: 'startReplicationTask',
        parameters: {
          ReplicationTaskArn: this.replicationTask.ref,
          StartReplicationTaskType: 'start-replication',
        },
        physicalResourceId: cr.PhysicalResourceId.of(`${CONFIG.projectName}-search-cdc-start`),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ['dms:StartReplicationTask'],
          resources: [this.replicationTask.ref],
        }),
      ]),
      timeout: cdk.Duration.minutes(2),
    });
    starter.node.addDependency(this.replicationTask);

    this.replicationTaskArn = this.replicationTask.ref;
    new cdk.CfnOutput(this, 'DmsReplicationInstanceArn', { value: this.replicationInstance.ref });
    new cdk.CfnOutput(this, 'DmsReplicationTaskArn', { value: this.replicationTaskArn });
  }
}
