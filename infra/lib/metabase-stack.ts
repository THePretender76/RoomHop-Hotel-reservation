import * as cdk from 'aws-cdk-lib';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as path from 'path';
import { Construct } from 'constructs';
import { CONFIG } from './config';
import { SecurityGroups } from './network-stack';

export interface MetabaseStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  securityGroups: SecurityGroups;
  dbSecret: secretsmanager.ISecret;
  dbEndpoint: string;
  cluster: ecs.ICluster;
  alb: elbv2.ApplicationLoadBalancer;
  analyticsBucket: s3.IBucket;
  athenaResultsBucket: s3.IBucket;
  glueDatabaseName: string;
  wafAclArn: string;
}

export class MetabaseStack extends cdk.Stack {
  public readonly metabaseRepository: ecr.Repository;
  public readonly metabaseService: ecs.FargateService;
  public readonly distribution: cloudfront.Distribution;
  public readonly metabaseUrl: string;

  constructor(scope: Construct, id: string, props: MetabaseStackProps) {
    super(scope, id, props);

    const metabaseSecret = new secretsmanager.Secret(this, 'MetabaseDbSecret', {
      secretName: `${CONFIG.projectName}/metabase/credentials`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          host: props.dbEndpoint,
          port: CONFIG.rds.port,
          database: 'metabase_db',
          username: 'metabase_user',
        }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    const initLogs = new logs.LogGroup(this, 'MetabaseDbInitLogs', {
      logGroupName: `/aws/lambda/${CONFIG.projectName}-metabase-db-init`,
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const initFunction = new lambda.Function(this, 'MetabaseDbInitFunction', {
      functionName: `${CONFIG.projectName}-metabase-db-init`,
      runtime: lambda.Runtime.NODEJS_24_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../services/lambda/metabase-db-init')),
      timeout: cdk.Duration.minutes(3),
      memorySize: 256,
      vpc: props.vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [props.securityGroups.lambdaSg],
      environment: {
        ADMIN_SECRET_ARN: props.dbSecret.secretArn,
        METABASE_SECRET_ARN: metabaseSecret.secretArn,
      },
      logGroup: initLogs,
    });
    props.dbSecret.grantRead(initFunction);
    metabaseSecret.grantRead(initFunction);

    const initProvider = new cr.Provider(this, 'MetabaseDbInitProvider', {
      onEventHandler: initFunction,
    });
    const initResource = new cdk.CustomResource(this, 'MetabaseDbInit', {
      serviceToken: initProvider.serviceToken,
      properties: { version: '2' },
    });

    const metabaseSg = new ec2.SecurityGroup(this, 'MetabaseSecurityGroup', {
      vpc: props.vpc,
      allowAllOutbound: true,
      description: 'Metabase ECS task access',
    });
    metabaseSg.addIngressRule(props.securityGroups.albSg, ec2.Port.tcp(3000), 'Allow internal ALB');
    new ec2.CfnSecurityGroupIngress(this, 'MetabaseToRdsIngress', {
      groupId: props.securityGroups.rdsSg.securityGroupId,
      sourceSecurityGroupId: metabaseSg.securityGroupId,
      ipProtocol: 'tcp',
      fromPort: CONFIG.rds.port,
      toPort: CONFIG.rds.port,
      description: 'Allow Metabase application database access',
    });

    this.metabaseRepository = new ecr.Repository(this, 'MetabaseRepository', {
      repositoryName: `${CONFIG.projectName}/metabase`,
      imageScanOnPush: true,
      lifecycleRules: [{ maxImageCount: 10 }],
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
    });

    const executionRole = new iam.Role(this, 'MetabaseExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });
    metabaseSecret.grantRead(executionRole);

    const taskRole = new iam.Role(this, 'MetabaseTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'ssmmessages:CreateControlChannel',
        'ssmmessages:CreateDataChannel',
        'ssmmessages:OpenControlChannel',
        'ssmmessages:OpenDataChannel',
      ],
      resources: ['*'],
    }));
    props.analyticsBucket.grantRead(taskRole);
    props.athenaResultsBucket.grantReadWrite(taskRole);
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'athena:StartQueryExecution',
        'athena:GetQueryExecution',
        'athena:GetQueryResults',
        'athena:StopQueryExecution',
        'athena:GetWorkGroup',
      ],
      resources: ['*'],
    }));
    taskRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        'glue:GetDatabase',
        'glue:GetDatabases',
        'glue:GetTable',
        'glue:GetTables',
        'glue:GetPartition',
        'glue:GetPartitions',
      ],
      resources: ['*'],
    }));

    const logGroup = new logs.LogGroup(this, 'MetabaseLogs', {
      logGroupName: `/ecs/${CONFIG.projectName}/metabase`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'MetabaseTaskDefinition', {
      cpu: CONFIG.ecs.metabaseService.cpu,
      memoryLimitMiB: CONFIG.ecs.metabaseService.memory,
      executionRole,
      taskRole,
    });
    taskDefinition.addContainer('MetabaseContainer', {
      image: ecs.ContainerImage.fromAsset(path.join(__dirname, '../docker/metabase')),
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: 'metabase', logGroup }),
      portMappings: [{ containerPort: 3000 }],
      environment: {
        MB_DB_TYPE: 'mysql',
        MB_DB_PORT: String(CONFIG.rds.port),
        MB_DB_DBNAME: 'metabase_db',
        MB_JETTY_PORT: '3000',
        MB_ANON_TRACKING_ENABLED: 'false',
        AWS_REGION: CONFIG.region,
        ROOMHOP_ATHENA_DATABASE: props.glueDatabaseName,
        ROOMHOP_ATHENA_STAGING_DIR: `s3://${props.athenaResultsBucket.bucketName}/metabase/`,
      },
      secrets: {
        MB_DB_HOST: ecs.Secret.fromSecretsManager(metabaseSecret, 'host'),
        MB_DB_USER: ecs.Secret.fromSecretsManager(metabaseSecret, 'username'),
        MB_DB_PASS: ecs.Secret.fromSecretsManager(metabaseSecret, 'password'),
      },
    });

    this.metabaseService = new ecs.FargateService(this, 'MetabaseService', {
      cluster: props.cluster,
      taskDefinition,
      desiredCount: CONFIG.ecs.metabaseService.desiredCount,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { rollback: true },
      healthCheckGracePeriod: cdk.Duration.minutes(5),
      securityGroups: [metabaseSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      assignPublicIp: false,
      serviceName: `${CONFIG.projectName}-metabase`,
      enableExecuteCommand: true,
    });
    this.metabaseService.node.addDependency(initResource);

    const targetGroup = new elbv2.ApplicationTargetGroup(this, 'MetabaseTargetGroup', {
      vpc: props.vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [this.metabaseService],
      healthCheck: {
        path: '/api/health',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
      stickinessCookieDuration: cdk.Duration.days(1),
    });
    const listener = new elbv2.ApplicationListener(this, 'MetabaseListener', {
      loadBalancer: props.alb,
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      open: false,
      defaultAction: elbv2.ListenerAction.forward([targetGroup]),
    });

    const vpcLink = new apigwv2.VpcLink(this, 'MetabaseVpcLink', {
      vpc: props.vpc,
      subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [props.securityGroups.vpcLinkSg],
      vpcLinkName: `${CONFIG.projectName}-metabase-vpc-link`,
    });
    const api = new apigwv2.HttpApi(this, 'MetabaseHttpApi', {
      apiName: `${CONFIG.projectName}-metabase-api`,
      defaultIntegration: new integrations.HttpAlbIntegration('MetabaseAlbIntegration', listener, {
        vpcLink,
      }),
    });

    const apiDomain = cdk.Fn.select(2, cdk.Fn.split('/', api.apiEndpoint));
    this.distribution = new cloudfront.Distribution(this, 'MetabaseDistribution', {
      comment: 'RoomHop Metabase dashboard',
      webAclId: props.wafAclArn,
      defaultBehavior: {
        origin: new origins.HttpOrigin(apiDomain, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          readTimeout: cdk.Duration.seconds(60),
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });
    this.metabaseUrl = `https://${this.distribution.distributionDomainName}`;

    new cdk.CfnOutput(this, 'MetabaseUrl', {
      value: this.metabaseUrl,
      description: 'Set this value as MB_SITE_URL after the first deployment.',
    });
    new cdk.CfnOutput(this, 'MetabaseRepositoryUri', { value: this.metabaseRepository.repositoryUri });
    new cdk.CfnOutput(this, 'MetabaseServiceName', { value: this.metabaseService.serviceName });
  }
}
