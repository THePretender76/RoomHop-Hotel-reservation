import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import { Construct } from 'constructs';
import { CONFIG } from './config';
import { SecurityGroups } from './network-stack';

export interface OpenSearchStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  securityGroups: SecurityGroups;
}

export class OpenSearchStack extends cdk.Stack {
  public readonly domain: opensearch.Domain;
  public readonly domainEndpoint: string;
  public readonly domainArn: string;

  constructor(scope: Construct, id: string, props: OpenSearchStackProps) {
    super(scope, id, props);

    this.domain = new opensearch.Domain(this, 'RoomHopSearch', {
      domainName: CONFIG.opensearch.domainName,
      version: opensearch.EngineVersion.OPENSEARCH_2_11,
      capacity: {
        dataNodes: CONFIG.opensearch.instanceCount,
        dataNodeInstanceType: CONFIG.opensearch.instanceType,
        multiAzWithStandbyEnabled: false,
      },
      ebs: {
        volumeSize: 20,
        volumeType: ec2.EbsDeviceVolumeType.GP3,
      },
      vpc: props.vpc,
      // A one-node domain without zone awareness must use exactly one VPC subnet.
      // The VPC still spans two AZs for ECS and the other private workloads.
      vpcSubnets: [{ subnets: [props.vpc.isolatedSubnets[0]] }],
      securityGroups: [props.securityGroups.opensearchSg],
      zoneAwareness: { enabled: false },
      encryptionAtRest: { enabled: true },
      nodeToNodeEncryption: true,
      enforceHttps: true,
      tlsSecurityPolicy: opensearch.TLSSecurityPolicy.TLS_1_2,
      // DMS signs its OpenSearch calls with IAM; FGAC with a master password is not used.
      accessPolicies: [
        new iam.PolicyStatement({
          principals: [new iam.AccountRootPrincipal()],
          actions: ['es:ESHttp*'],
          resources: [
            `arn:${cdk.Aws.PARTITION}:es:${cdk.Aws.REGION}:${cdk.Aws.ACCOUNT_ID}:domain/${CONFIG.opensearch.domainName}/*`,
          ],
        }),
      ],
      logging: {
        appLogEnabled: true,
        slowIndexLogEnabled: true,
        slowSearchLogEnabled: true,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.domainEndpoint = this.domain.domainEndpoint;
    this.domainArn = this.domain.domainArn;

    new cdk.CfnOutput(this, 'OpenSearchEndpoint', { value: this.domainEndpoint });
    new cdk.CfnOutput(this, 'OpenSearchDomainArn', { value: this.domainArn });
  }
}
