import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as events from 'aws-cdk-lib/aws-events';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as path from 'path';
import { Construct } from 'constructs';
import { CONFIG } from './config';
import { SecurityGroups } from './network-stack';

export interface ComputeStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  securityGroups: SecurityGroups;
  dbSecret: secretsmanager.ISecret;
  searchDomain: opensearch.IDomain;
  eventBus: events.IEventBus;
  userPool: cognito.IUserPool;
  userPoolClient: cognito.IUserPoolClient;
}

interface ServiceDefinition {
  readonly id: string;
  readonly serviceName: string;
  readonly imageDirectory: string;
  readonly config: { cpu: number; memory: number; desiredCount: number };
  readonly taskRole: iam.Role;
  readonly environment: Record<string, string>;
}

export class ComputeStack extends cdk.Stack {
  public readonly alb: elbv2.ApplicationLoadBalancer;
  public readonly albListener: elbv2.ApplicationListener;
  public readonly cluster: ecs.Cluster;
  public readonly searchRepository: ecr.Repository;
  public readonly reservationRepository: ecr.Repository;
  public readonly xrayRepository: ecr.Repository;
  public readonly searchService: ecs.FargateService;
  public readonly reservationService: ecs.FargateService;

  constructor(scope: Construct, id: string, props: ComputeStackProps) {
    super(scope, id, props);

    const {
      vpc,
      securityGroups,
      dbSecret,
      searchDomain,
      eventBus,
      userPool,
      userPoolClient,
    } = props;

    this.searchRepository = this.createRepository('SearchServiceRepo', 'search-service');
    this.reservationRepository = this.createRepository('ReservationServiceRepo', 'reservation-service');
    this.xrayRepository = this.createRepository('XRayDaemonRepo', 'xray-daemon');

    this.cluster = new ecs.Cluster(this, 'RoomHopCluster', {
      vpc,
      clusterName: `${CONFIG.projectName}-cluster`,
      containerInsightsV2: ecs.ContainerInsights.ENHANCED,
    });

    this.alb = new elbv2.ApplicationLoadBalancer(this, 'InternalAlb', {
      vpc,
      internetFacing: false,
      securityGroup: securityGroups.albSg,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      loadBalancerName: `${CONFIG.projectName}-internal-alb`,
    });

    this.albListener = this.alb.addListener('HttpListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        messageBody: '{"error":"Not Found"}',
        contentType: 'application/json',
      }),
    });

    const executionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });
    dbSecret.grantRead(executionRole);

    const searchTaskRole = new iam.Role(this, 'SearchTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    dbSecret.grantRead(searchTaskRole);
    searchTaskRole.addToPolicy(new iam.PolicyStatement({
      actions: ['es:ESHttpGet', 'es:ESHttpHead', 'es:ESHttpPost'],
      resources: [`${searchDomain.domainArn}/*`],
    }));
    searchTaskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess')
    );
    this.grantEcsExec(searchTaskRole);

    const reservationTaskRole = new iam.Role(this, 'ReservationTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    dbSecret.grantRead(reservationTaskRole);
    eventBus.grantPutEventsTo(reservationTaskRole);
    reservationTaskRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:AdminAddUserToGroup',
        'cognito-idp:AdminRemoveUserFromGroup',
        'cognito-idp:AdminUpdateUserAttributes',
      ],
      resources: [userPool.userPoolArn],
    }));
    reservationTaskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AWSXRayDaemonWriteAccess')
    );
    this.grantEcsExec(reservationTaskRole);

    const commonEnvironment = {
      DB_SECRET_ARN: dbSecret.secretArn,
      DB_NAME: CONFIG.rds.databaseName,
      AWS_REGION: CONFIG.region,
      NODE_ENV: 'production',
    };

    const search = this.createService(vpc, securityGroups, executionRole, {
      id: 'Search',
      serviceName: 'search',
      imageDirectory: path.join(__dirname, '../../services/search-service'),
      config: CONFIG.ecs.searchService,
      taskRole: searchTaskRole,
      environment: {
        ...commonEnvironment,
        OPENSEARCH_ENDPOINT: `https://${searchDomain.domainEndpoint}`,
      },
    });

    const reservation = this.createService(vpc, securityGroups, executionRole, {
      id: 'Reservation',
      serviceName: 'reservation',
      imageDirectory: path.join(__dirname, '../../services/reservation-service'),
      config: CONFIG.ecs.reservationService,
      taskRole: reservationTaskRole,
      environment: {
        ...commonEnvironment,
        EVENT_BUS_NAME: eventBus.eventBusName,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
      },
    });

    this.searchService = search.service;
    this.reservationService = reservation.service;

    new elbv2.ApplicationListenerRule(this, 'SearchRule', {
      listener: this.albListener,
      priority: 10,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/v1/search*'])],
      targetGroups: [search.targetGroup],
    });
    new elbv2.ApplicationListenerRule(this, 'ReservationRule', {
      listener: this.albListener,
      priority: 20,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/v1/reservations*'])],
      targetGroups: [reservation.targetGroup],
    });
    new elbv2.ApplicationListenerRule(this, 'AdminRule', {
      listener: this.albListener,
      priority: 25,
      conditions: [elbv2.ListenerCondition.pathPatterns(['/v1/admin*'])],
      targetGroups: [reservation.targetGroup],
    });

    new cdk.CfnOutput(this, 'AlbDnsName', { value: this.alb.loadBalancerDnsName });
    new cdk.CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName });
    new cdk.CfnOutput(this, 'SearchRepositoryUri', { value: this.searchRepository.repositoryUri });
    new cdk.CfnOutput(this, 'ReservationRepositoryUri', { value: this.reservationRepository.repositoryUri });
    new cdk.CfnOutput(this, 'XRayRepositoryUri', { value: this.xrayRepository.repositoryUri });
  }

  private createRepository(id: string, name: string): ecr.Repository {
    return new ecr.Repository(this, id, {
      repositoryName: `${CONFIG.projectName}/${name}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 15 }],
    });
  }

  private grantEcsExec(role: iam.Role): void {
    role.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ssmmessages:CreateControlChannel',
        'ssmmessages:CreateDataChannel',
        'ssmmessages:OpenControlChannel',
        'ssmmessages:OpenDataChannel',
      ],
      resources: ['*'],
    }));
  }

  private createService(
    vpc: ec2.Vpc,
    securityGroups: SecurityGroups,
    executionRole: iam.Role,
    definition: ServiceDefinition
  ): { service: ecs.FargateService; targetGroup: elbv2.ApplicationTargetGroup } {
    const logGroup = new logs.LogGroup(this, `${definition.id}Logs`, {
      logGroupName: `/ecs/${CONFIG.projectName}/${definition.serviceName}`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, `${definition.id}TaskDefinition`, {
      cpu: definition.config.cpu,
      memoryLimitMiB: definition.config.memory,
      executionRole,
      taskRole: definition.taskRole,
    });

    taskDefinition.addContainer(`${definition.id}Container`, {
      // CDK assets make the first deployment runnable before the CI/CD repos contain images.
      image: ecs.ContainerImage.fromAsset(definition.imageDirectory),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: definition.serviceName, logGroup }),
      environment: definition.environment,
      portMappings: [{ containerPort: 3000 }],
      healthCheck: {
        command: ['CMD-SHELL', 'curl -fsS http://localhost:3000/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        retries: 3,
        startPeriod: cdk.Duration.seconds(60),
      },
    });

    taskDefinition.addContainer(`${definition.id}XRayDaemon`, {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, '../docker/xray')),
      essential: false,
      portMappings: [{ containerPort: 2000, protocol: ecs.Protocol.UDP }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: `${definition.serviceName}-xray`, logGroup }),
      cpu: 32,
      memoryReservationMiB: 256,
    });

    const service = new ecs.FargateService(this, `${definition.id}Service`, {
      cluster: this.cluster,
      taskDefinition,
      desiredCount: definition.config.desiredCount,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { rollback: true },
      healthCheckGracePeriod: cdk.Duration.seconds(90),
      securityGroups: [securityGroups.ecsSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      assignPublicIp: false,
      serviceName: `${CONFIG.projectName}-${definition.serviceName}`,
      enableExecuteCommand: true,
    });

    const scaling = service.autoScaleTaskCount({ minCapacity: 1, maxCapacity: 4 });
    scaling.scaleOnCpuUtilization(`${definition.id}CpuScaling`, {
      targetUtilizationPercent: 60,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(30),
    });
    scaling.scaleOnMemoryUtilization(`${definition.id}MemoryScaling`, {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.seconds(60),
      scaleOutCooldown: cdk.Duration.seconds(30),
    });

    const targetGroup = new elbv2.ApplicationTargetGroup(this, `${definition.id}TargetGroup`, {
      vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service],
      targetGroupName: `${CONFIG.projectName}-${definition.serviceName}`,
      deregistrationDelay: cdk.Duration.seconds(30),
      healthCheck: {
        path: '/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    return { service, targetGroup };
  }
}
