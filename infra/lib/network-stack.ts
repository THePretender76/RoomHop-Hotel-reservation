import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { Construct } from 'constructs';
import { CONFIG } from './config';

/**
 * Security groups exported for use by other stacks.
 * Strict least-privilege: each layer only accepts traffic from the layer above.
 */
export interface SecurityGroups {
  albSg: ec2.SecurityGroup;
  ecsSg: ec2.SecurityGroup;
  rdsSg: ec2.SecurityGroup;
  opensearchSg: ec2.SecurityGroup;
  lambdaSg: ec2.SecurityGroup;
  endpointSg: ec2.SecurityGroup;
}

export class NetworkStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;
  public readonly securityGroups: SecurityGroups;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ─── VPC ────────────────────────────────────────────────────────────────────
    // NO NAT Gateway — all subnets are PRIVATE_ISOLATED.
    // Services reach AWS APIs exclusively through VPC Endpoints.
    this.vpc = new ec2.Vpc(this, 'RoomHopVpc', {
      ipAddresses: ec2.IpAddresses.cidr(CONFIG.vpc.cidr),
      maxAzs: CONFIG.vpc.maxAzs,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // ─── Security Groups ────────────────────────────────────────────────────────

    // VPC Endpoint SG — allows inbound HTTPS from the entire VPC CIDR
    const endpointSg = new ec2.SecurityGroup(this, 'EndpointSg', {
      vpc: this.vpc,
      description: 'Security group for VPC Interface Endpoints',
      allowAllOutbound: true,
    });
    endpointSg.addIngressRule(
      ec2.Peer.ipv4(CONFIG.vpc.cidr),
      ec2.Port.tcp(443),
      'Allow HTTPS from VPC for endpoint access'
    );

    // ALB SG — accepts traffic from VPC Link (API Gateway sends traffic from within VPC)
    const albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc: this.vpc,
      description: 'Security group for internal ALB',
      allowAllOutbound: true,
    });
    // API Gateway VPC Link sends traffic from within the VPC subnets
    albSg.addIngressRule(
      ec2.Peer.ipv4(CONFIG.vpc.cidr),
      ec2.Port.tcp(80),
      'Allow HTTP from VPC Link (API Gateway)'
    );

    // ECS SG — accepts traffic only from the ALB
    const ecsSg = new ec2.SecurityGroup(this, 'EcsSg', {
      vpc: this.vpc,
      description: 'Security group for ECS Fargate tasks',
      allowAllOutbound: true,
    });
    ecsSg.addIngressRule(
      albSg,
      ec2.Port.tcp(3000),
      'Allow traffic from ALB on application port'
    );

    // RDS SG — accepts traffic only from ECS tasks
    const rdsSg = new ec2.SecurityGroup(this, 'RdsSg', {
      vpc: this.vpc,
      description: 'Security group for RDS MySQL',
      allowAllOutbound: false,
    });
    rdsSg.addIngressRule(
      ecsSg,
      ec2.Port.tcp(CONFIG.rds.port),
      'Allow MySQL from ECS tasks only'
    );

    // OpenSearch SG — accepts traffic only from ECS tasks
    const opensearchSg = new ec2.SecurityGroup(this, 'OpenSearchSg', {
      vpc: this.vpc,
      description: 'Security group for OpenSearch domain',
      allowAllOutbound: false,
    });
    opensearchSg.addIngressRule(
      ecsSg,
      ec2.Port.tcp(443),
      'Allow HTTPS from ECS tasks only'
    );

    // Lambda SG — for event-driven Lambda functions in VPC
    const lambdaSg = new ec2.SecurityGroup(this, 'LambdaSg', {
      vpc: this.vpc,
      description: 'Security group for Lambda functions in VPC',
      allowAllOutbound: true,
    });

    this.securityGroups = {
      albSg,
      ecsSg,
      rdsSg,
      opensearchSg,
      lambdaSg,
      endpointSg,
    };

    // ─── VPC Endpoints ──────────────────────────────────────────────────────────
    // Gateway endpoint for S3 (free, no SG needed)
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }],
    });

    // Interface endpoints — all use the endpointSg and are placed in private subnets
    const interfaceEndpoints: { id: string; service: ec2.InterfaceVpcEndpointAwsService }[] = [
      { id: 'EcrApiEndpoint', service: ec2.InterfaceVpcEndpointAwsService.ECR },
      { id: 'EcrDkrEndpoint', service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER },
      { id: 'CloudWatchLogsEndpoint', service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS },
      { id: 'SecretsManagerEndpoint', service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER },
      { id: 'EventBridgeEndpoint', service: ec2.InterfaceVpcEndpointAwsService.EVENTBRIDGE },
      { id: 'SqsEndpoint', service: ec2.InterfaceVpcEndpointAwsService.SQS },
      { id: 'SesEndpoint', service: ec2.InterfaceVpcEndpointAwsService.SES },
    ];

    for (const ep of interfaceEndpoints) {
      this.vpc.addInterfaceEndpoint(ep.id, {
        service: ep.service,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        securityGroups: [endpointSg],
        privateDnsEnabled: true,
      });
    }

    // ─── Outputs ────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'VpcId', { value: this.vpc.vpcId });
  }
}
