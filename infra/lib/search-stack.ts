import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { CONFIG } from './config';
import { SecurityGroups } from './network-stack';

export interface SearchStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  securityGroups: SecurityGroups;
}

export class SearchStack extends cdk.Stack {
  public readonly domainEndpoint: string;

  constructor(scope: Construct, id: string, props: SearchStackProps) {
    super(scope, id, props);

    const { vpc, securityGroups } = props;

    // ─── OpenSearch Domain ──────────────────────────────────────────────────────
    // Deployed inside VPC private subnets for network isolation.
    // 2 data nodes across 2 AZs for high availability.
    const domain = new opensearch.Domain(this, 'RoomHopSearch', {
      domainName: CONFIG.opensearch.domainName,
      version: opensearch.EngineVersion.OPENSEARCH_2_11,
      vpc,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }],
      securityGroups: [securityGroups.opensearchSg],
      // Cluster sizing — 2 nodes for Multi-AZ
      capacity: {
        dataNodeInstanceType: CONFIG.opensearch.instanceType,
        dataNodes: CONFIG.opensearch.instanceCount,
        multiAzWithStandbyEnabled: false,
      },
      // Zone awareness disabled for cost savings (single node)
      zoneAwareness: {
        enabled: false,
      },
      // EBS storage per data node
      ebs: {
        volumeSize: 20,
        volumeType: ec2.EbsDeviceVolumeType.GP3,
      },
      // Encryption at rest and in transit
      encryptionAtRest: { enabled: true },
      nodeToNodeEncryption: true,
      enforceHttps: true,
      // Fine-grained access control
      fineGrainedAccessControl: {
        masterUserArn: `arn:aws:iam::${cdk.Aws.ACCOUNT_ID}:root`,
      },
      // Access policy — allow from VPC only (restrict to account)
      accessPolicies: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          principals: [new iam.AccountRootPrincipal()],
          actions: ['es:*'],
          resources: [`arn:aws:es:${CONFIG.region}:${cdk.Aws.ACCOUNT_ID}:domain/${CONFIG.opensearch.domainName}/*`],
        }),
      ],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    this.domainEndpoint = domain.domainEndpoint;

    // ─── Outputs ────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'OpenSearchEndpoint', {
      value: domain.domainEndpoint,
      description: 'OpenSearch domain endpoint',
    });
  }
}
