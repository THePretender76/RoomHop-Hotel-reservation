import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as dms from 'aws-cdk-lib/aws-dms';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { CONFIG } from './config';
import { SecurityGroups } from './network-stack';

export interface DmsStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  securityGroups: SecurityGroups;
  dbSecret: secretsmanager.ISecret;
  dbEndpoint: string;
  opensearchEndpoint: string;
  opensearchArn: string;
}

export class DmsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DmsStackProps) {
    super(scope, id, props);

    const { vpc, securityGroups, dbSecret, dbEndpoint, opensearchEndpoint, opensearchArn } = props;

    // ─── DMS Security Group ─────────────────────────────────────────────────────
    const dmsSg = new ec2.SecurityGroup(this, 'DmsSg', {
      vpc,
      description: 'Security group for DMS replication instance',
      allowAllOutbound: true,
    });

    // DMS needs to connect to RDS (MySQL port)
    securityGroups.rdsSg.addIngressRule(
      dmsSg,
      ec2.Port.tcp(CONFIG.rds.port),
      'Allow MySQL from DMS replication instance'
    );

    // DMS needs to connect to OpenSearch (HTTPS)
    securityGroups.opensearchSg.addIngressRule(
      dmsSg,
      ec2.Port.tcp(443),
      'Allow HTTPS from DMS to OpenSearch'
    );

    // ─── DMS Subnet Group ───────────────────────────────────────────────────────
    const subnetGroup = new dms.CfnReplicationSubnetGroup(this, 'DmsSubnetGroup', {
      replicationSubnetGroupIdentifier: `${CONFIG.projectName}-dms-subnet-group`,
      replicationSubnetGroupDescription: 'DMS subnet group for RoomHop CDC',
      subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds,
    });

    // ─── DMS Replication Instance ───────────────────────────────────────────────
    // Single-AZ, smallest instance for testing
    const replicationInstance = new dms.CfnReplicationInstance(this, 'DmsInstance', {
      replicationInstanceIdentifier: `${CONFIG.projectName}-dms-instance`,
      replicationInstanceClass: 'dms.t3.micro',
      allocatedStorage: 20,
      vpcSecurityGroupIds: [dmsSg.securityGroupId],
      replicationSubnetGroupIdentifier: subnetGroup.replicationSubnetGroupIdentifier,
      multiAz: false,
      publiclyAccessible: false,
      engineVersion: '3.5.3',
    });
    replicationInstance.addDependency(subnetGroup);

    // ─── IAM Role for DMS to access OpenSearch ──────────────────────────────────
    const dmsOpenSearchRole = new iam.Role(this, 'DmsOpenSearchRole', {
      roleName: `${CONFIG.projectName}-dms-opensearch-role`,
      assumedBy: new iam.ServicePrincipal('dms.amazonaws.com'),
    });

    dmsOpenSearchRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['es:ESHttpPost', 'es:ESHttpPut', 'es:ESHttpDelete', 'es:ESHttpGet'],
      resources: [`${opensearchArn}/*`],
    }));

    // ─── Source Endpoint (RDS MySQL) ────────────────────────────────────────────
    const sourceEndpoint = new dms.CfnEndpoint(this, 'SourceEndpoint', {
      endpointIdentifier: `${CONFIG.projectName}-source-mysql`,
      endpointType: 'source',
      engineName: 'mysql',
      serverName: dbEndpoint,
      port: CONFIG.rds.port,
      databaseName: CONFIG.rds.databaseName,
      username: 'roomhop_admin',
      password: cdk.Fn.join('', [
        '{{resolve:secretsmanager:',
        `${CONFIG.projectName}/rds/credentials`,
        ':SecretString:password}}',
      ]),
      sslMode: 'none',
    });

    // ─── Target Endpoint (OpenSearch) ───────────────────────────────────────────
    const targetEndpoint = new dms.CfnEndpoint(this, 'TargetEndpoint', {
      endpointIdentifier: `${CONFIG.projectName}-target-opensearch`,
      endpointType: 'target',
      engineName: 'opensearch',
      elasticsearchSettings: {
        endpointUri: `https://${opensearchEndpoint}`,
        serviceAccessRoleArn: dmsOpenSearchRole.roleArn,
        errorRetryDuration: 300,
        fullLoadErrorPercentage: 10,
      },
    });

    // ─── Replication Task (Full Load + CDC) ─────────────────────────────────────
    // Migrates existing data then continuously replicates changes
    const replicationTask = new dms.CfnReplicationTask(this, 'CdcTask', {
      replicationTaskIdentifier: `${CONFIG.projectName}-cdc-task`,
      replicationInstanceArn: replicationInstance.ref,
      sourceEndpointArn: sourceEndpoint.ref,
      targetEndpointArn: targetEndpoint.ref,
      migrationType: 'full-load-and-cdc',
      tableMappings: JSON.stringify({
        rules: [
          {
            'rule-type': 'selection',
            'rule-id': '1',
            'rule-name': 'include-hotels',
            'object-locator': { 'schema-name': CONFIG.rds.databaseName, 'table-name': 'hotel' },
            'rule-action': 'include',
          },
          {
            'rule-type': 'selection',
            'rule-id': '2',
            'rule-name': 'include-room-types',
            'object-locator': { 'schema-name': CONFIG.rds.databaseName, 'table-name': 'room_type' },
            'rule-action': 'include',
          },
          {
            'rule-type': 'selection',
            'rule-id': '3',
            'rule-name': 'include-room-type-rates',
            'object-locator': { 'schema-name': CONFIG.rds.databaseName, 'table-name': 'room_type_rate' },
            'rule-action': 'include',
          },
          {
            'rule-type': 'selection',
            'rule-id': '4',
            'rule-name': 'include-room-type-inventory',
            'object-locator': { 'schema-name': CONFIG.rds.databaseName, 'table-name': 'room_type_inventory' },
            'rule-action': 'include',
          },
          {
            'rule-type': 'selection',
            'rule-id': '5',
            'rule-name': 'include-hotel-images',
            'object-locator': { 'schema-name': CONFIG.rds.databaseName, 'table-name': 'hotel_images' },
            'rule-action': 'include',
          },
        ],
      }),
      replicationTaskSettings: JSON.stringify({
        TargetMetadata: {
          TargetSchema: '',
          SupportLobs: false,
          FullLobMode: false,
          LimitedSizeLobMode: false,
        },
        FullLoadSettings: {
          TargetTablePrepMode: 'DROP_AND_CREATE',
        },
        Logging: {
          EnableLogging: true,
          LogComponents: [
            { Id: 'SOURCE_UNLOAD', Severity: 'LOGGER_SEVERITY_DEFAULT' },
            { Id: 'TARGET_LOAD', Severity: 'LOGGER_SEVERITY_DEFAULT' },
            { Id: 'SOURCE_CAPTURE', Severity: 'LOGGER_SEVERITY_DEFAULT' },
            { Id: 'TARGET_APPLY', Severity: 'LOGGER_SEVERITY_DEFAULT' },
          ],
        },
        ChangeProcessingTuning: {
          BatchApplyEnabled: true,
        },
      }),
    });
    replicationTask.addDependency(replicationInstance);

    // ─── Outputs ────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'DmsReplicationInstanceArn', {
      value: replicationInstance.ref,
      description: 'DMS replication instance ARN',
    });

    new cdk.CfnOutput(this, 'DmsTaskArn', {
      value: replicationTask.ref,
      description: 'DMS replication task ARN',
    });
  }
}
