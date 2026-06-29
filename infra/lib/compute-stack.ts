import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { CONFIG } from './config';
import { SecurityGroups } from './network-stack';

export interface ComputeStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  securityGroups: SecurityGroups;
  dbSecret: secretsmanager.ISecret;
  dbEndpoint: string;
  opensearchEndpoint: string;
}

export class ComputeStack extends cdk.Stack {
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly albListener: elbv2.ApplicationListener;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const { vpc, securityGroups, dbSecret, dbEndpoint, opensearchEndpoint } = props;

    // ─── ECR Repositories ───────────────────────────────────────────────────────
    const searchRepo = new ecr.Repository(this, 'SearchServiceRepo', {
      repositoryName: `${CONFIG.projectName}/search-service`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      imageScanOnPush: true,
    });

    const reservationRepo = new ecr.Repository(this, 'ReservationServiceRepo', {
      repositoryName: `${CONFIG.projectName}/reservation-service`,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      imageScanOnPush: true,
    });

    // ─── ECS Cluster ────────────────────────────────────────────────────────────
    const cluster = new ecs.Cluster(this, 'RoomHopCluster', {
      vpc,
      clusterName: `${CONFIG.projectName}-cluster`,
      containerInsights: true,
    });

    // ─── Internal ALB ───────────────────────────────────────────────────────────
    // Internal ALB — not internet-facing. Receives traffic from API Gateway VPC Link.
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'InternalAlb', {
      vpc,
      internetFacing: false,
      securityGroup: securityGroups.albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      loadBalancerName: `${CONFIG.projectName}-internal-alb`,
    });

    // Default listener on port 80
    this.albListener = this.alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        messageBody: '{"error":"Not Found"}',
        contentType: 'application/json',
      }),
    });

    // ─── Shared Task Execution Role ─────────────────────────────────────────────
    const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });

    // Allow pulling secrets from Secrets Manager
    dbSecret.grantRead(taskExecutionRole);

    // ─── Shared Task Role ───────────────────────────────────────────────────────
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    // Grant access to read DB secret at runtime
    dbSecret.grantRead(taskRole);

    // ─── Common environment variables ───────────────────────────────────────────
    const commonEnv: { [key: string]: string } = {
      DB_SECRET_ARN: dbSecret.secretArn,
      DB_NAME: CONFIG.rds.databaseName,
      OPENSEARCH_ENDPOINT: `https://${opensearchEndpoint}`,
      AWS_REGION: CONFIG.region,
      NODE_ENV: 'production',
    };

    // ─── Helper: Create Fargate Service ─────────────────────────────────────────
    const createService = (
      serviceName: string,
      repo: ecr.Repository,
      serviceConfig: { cpu: number; memory: number; desiredCount: number },
      pathPattern: string
    ) => {
      const logGroup = new logs.LogGroup(this, `${serviceName}Logs`, {
        logGroupName: `/ecs/${CONFIG.projectName}/${serviceName}`,
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const taskDefinition = new ecs.FargateTaskDefinition(this, `${serviceName}TaskDef`, {
        cpu: serviceConfig.cpu,
        memoryLimitMiB: serviceConfig.memory,
        executionRole: taskExecutionRole,
        taskRole,
      });

      taskDefinition.addContainer(`${serviceName}Container`, {
        image: ecs.ContainerImage.fromEcrRepository(repo, 'latest'),
        logging: ecs.LogDrivers.awsLogs({
          streamPrefix: serviceName,
          logGroup,
        }),
        environment: commonEnv,
        portMappings: [{ containerPort: 3000 }],
        healthCheck: {
          command: ['CMD-SHELL', 'curl -f http://localhost:3000/health || exit 1'],
          interval: cdk.Duration.seconds(30),
          timeout: cdk.Duration.seconds(5),
          retries: 3,
          startPeriod: cdk.Duration.seconds(60),
        },
      });

      const service = new ecs.FargateService(this, `${serviceName}Service`, {
        cluster,
        taskDefinition,
        desiredCount: serviceConfig.desiredCount,
        securityGroups: [securityGroups.ecsSg],
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
        assignPublicIp: false,
        serviceName: `${CONFIG.projectName}-${serviceName}`,
      });

      // Target group for ALB path-based routing
      const targetGroup = new elbv2.ApplicationTargetGroup(this, `${serviceName}Tg`, {
        vpc,
        port: 3000,
        protocol: elbv2.ApplicationProtocol.HTTP,
        targets: [service],
        healthCheck: {
          path: '/health',
          interval: cdk.Duration.seconds(30),
          healthyThresholdCount: 2,
          unhealthyThresholdCount: 3,
        },
        targetGroupName: `${CONFIG.projectName}-${serviceName}`,
      });

      // Add path-based routing rule to the listener
      new elbv2.ApplicationListenerRule(this, `${serviceName}Rule`, {
        listener: this.albListener,
        priority: pathPattern === '/v1/search*' ? 10 : pathPattern === '/v1/reservations*' ? 20 : 30,
        conditions: [elbv2.ListenerCondition.pathPatterns([pathPattern])],
        targetGroups: [targetGroup],
      });

      return service;
    };

    // ─── Create Services ────────────────────────────────────────────────────────
    createService('search', searchRepo, CONFIG.ecs.searchService, '/v1/search*');
    createService('reservation', reservationRepo, CONFIG.ecs.reservationService, '/v1/reservations*');

    // ─── Outputs ────────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'AlbDnsName', {
      value: this.alb.loadBalancerDnsName,
      description: 'Internal ALB DNS name',
    });

    new cdk.CfnOutput(this, 'ClusterName', {
      value: cluster.clusterName,
      description: 'ECS cluster name',
    });
  }
}
