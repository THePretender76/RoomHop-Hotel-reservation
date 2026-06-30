import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { CONFIG } from './config';
import { SecurityGroups } from './network-stack';

export interface OpenSearchStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  securityGroups: SecurityGroups;
}

export class OpenSearchStack extends cdk.Stack {
  public readonly domainEndpoint: string;
  public readonly domainArn: string;

  constructor(scope: Construct, id: string, props: OpenSearchStackProps) {
    super(scope, id, props);

    const { vpc, securityGroups } = props;

    // ─── OpenSearch Domain ──────────────────────────────────────────────────────
    // Single-node cluster for cost efficiency during testing.
    // Placed in private subnets with VPC access only.
    const domain = new opensearch.Domain(this, 'RoomHopSearch', {
      domainName: CONFIG.opensearch.domainName,
      version: opensearch.EngineVersion.OPENSEARCH_2_11,

      // Capacity — single node for testing
      capacity: {
        dataNodes: CONFIG.opensearch.instanceCount,
        dataNodeInstanceType: CONFIG.opensearch.instanceType,
        multiAzWithStandbyEnabled: false,
      },

      // EBS storage
      ebs: {
        volumeSize: 20, // GB
        volumeType: ec2.EbsDeviceVolumeType.GP3,
      },

      // VPC placement — private subnets only
      vpc,
      vpcSubnets: [{ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }],
      securityGroups: [securityGroups.opensearchSg],

      // Single AZ for cost savings (matches single data node)
      zoneAwareness: { enabled: false },

      // Encryption
      encryptionAtRest: { enabled: true },
      nodeToNodeEncryption: true,
      enforceHttps: true,

      // Access policy — allow all principals within the VPC (SG controls access)
      accessPolicies: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          principals: [new iam.AnyPrincipal()],
          actions: ['es:*'],
          resources: [`arn:aws:es:${CONFIG.region}:${cdk.Aws.ACCOUNT_ID}:domain/${CONFIG.opensearch.domainName}/*`],
        }),
      ],

      // Fine-grained access control disabled (rely on IAM + SG)
      fineGrainedAccessControl: undefined,

      // Logging
      logging: {
        slowSearchLogEnabled: true,
        slowIndexLogEnabled: true,
        appLogEnabled: true,
      },

      // Removal policy for testing
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    this.domainEndpoint = domain.domainEndpoint;
    this.domainArn = domain.domainArn;

    // ─── Outputs ────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'OpenSearchEndpoint', {
      value: domain.domainEndpoint,
      description: 'OpenSearch domain endpoint',
    });

    new cdk.CfnOutput(this, 'OpenSearchDomainArn', {
      value: domain.domainArn,
      description: 'OpenSearch domain ARN',
    });
  }
}
