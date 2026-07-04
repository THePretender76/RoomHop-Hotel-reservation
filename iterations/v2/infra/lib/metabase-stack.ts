import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cloudfrontOrigins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import * as path from 'path';
import { Construct } from 'constructs';
import { CONFIG } from './config';
import { SecurityGroups } from './network-stack';

export interface MetabaseStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  securityGroups: SecurityGroups;
  /** The existing RDS secret (used to bootstrap metabase_db and metabase_user) */
  dbSecret: secretsmanager.ISecret;
  dbEndpoint: string;
  /** The existing ECS cluster (Metabase runs as another service on the same cluster) */
  cluster: ecs.Cluster;
  /** The existing internal ALB listener (we add a host-based rule for Metabase) */
  albListener: elbv2.ApplicationListener;
  alb: elbv2.ApplicationLoadBalancer;
  /** S3 bucket for Athena query results (Metabase uses this as its staging dir) */
  athenaResultsBucketName: string;
  /** S3 bucket containing the reservation analytics data */
  analyticsBucketName: string;
  /** Glue database name for Athena queries */
  glueDatabaseName: string;
  /** Existing WAF WebACL ARN — reused for the Metabase CloudFront distribution */
  wafAclArn: string;
}

export class MetabaseStack extends cdk.Stack {
  public readonly metabaseUrl: string;

  constructor(scope: Construct, id: string, props: MetabaseStackProps) {
    super(scope, id, props);

    const {
      vpc, securityGroups, dbSecret, dbEndpoint, cluster,
      albListener, alb, athenaResultsBucketName, analyticsBucketName,
      glueDatabaseName, wafAclArn,
    } = props;

    // ─── 1. Metabase DB credentials in Secrets Manager ──────────────────────────
    // Metabase gets its own dedicated MySQL database + user.
    // The secret is created here; the actual DB/user are provisioned by the Lambda below.
    const metabaseDbSecret = new secretsmanager.Secret(this, 'MetabaseDbSecret', {
      secretName: '/metabase/db-credentials',
      description: 'Metabase internal database credentials',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          host: dbEndpoint,
          port: '3306',
          database: 'metabase_db',
          username: 'metabase_user',
        }),
        generateStringKey: 'password',
        excludePunctuation: true,
        passwordLength: 32,
      },
    });

    // ─── 2. Lambda to bootstrap metabase_db + metabase_user in RDS ─────────────
    // Runs once at deploy time via Custom Resource.
    const dbInitLambda = new lambda.Function(this, 'MetabaseDbInitFn', {
      functionName: `${CONFIG.projectName}-metabase-db-init`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../services/lambda/metabase-db-init')),
      timeout: cdk.Duration.minutes(3),
      memorySize: 256,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [securityGroups.lambdaSg],
      environment: {
        ADMIN_SECRET_ARN: dbSecret.secretArn,
        METABASE_SECRET_ARN: metabaseDbSecret.secretArn,
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant Lambda access to both secrets
    dbSecret.grantRead(dbInitLambda);
    metabaseDbSecret.grantRead(dbInitLambda);

    // Allow Lambda SG to connect to RDS
    securityGroups.rdsSg.addIngressRule(
      securityGroups.lambdaSg,
      ec2.Port.tcp(CONFIG.rds.port),
      'Allow MySQL from Lambda (Metabase DB init)'
    );

    const dbInitProvider = new cr.Provider(this, 'MetabaseDbInitProvider', {
      onEventHandler: dbInitLambda,
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    const dbInitResource = new cdk.CustomResource(this, 'MetabaseDbInit', {
      serviceToken: dbInitProvider.serviceToken,
      properties: { initVersion: '1' },
    });

    // ─── 3. Dedicated Security Group for Metabase ECS tasks ─────────────────────
    // Separate from ecsSg — Metabase should not have access to the app services.
    const metabaseSg = new ec2.SecurityGroup(this, 'MetabaseSg', {
      vpc,
      description: 'Security group for Metabase ECS task',
      allowAllOutbound: true,
    });

    // ALB can reach Metabase on port 3000
    metabaseSg.addIngressRule(
      securityGroups.albSg,
      ec2.Port.tcp(3000),
      'Allow traffic from ALB to Metabase'
    );

    // Metabase needs to reach RDS on port 3306
    securityGroups.rdsSg.addIngressRule(
      metabaseSg,
      ec2.Port.tcp(CONFIG.rds.port),
      'Allow MySQL from Metabase ECS task'
    );

    // ─── 4. ECR Repository for Metabase (mirrored from Docker Hub) ──────────────
    // We mirror metabase/metabase:latest to ECR to avoid Docker Hub rate limits
    // and to keep images in the private network (no internet egress needed).
    const metabaseRepo = new ecr.Repository(this, 'MetabaseRepo', {
      repositoryName: `${CONFIG.projectName}/metabase`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      imageScanOnPush: true,
    });

    // ─── 5. Athena results bucket for Metabase queries ───────────────────────────
    // Dedicated prefix in the existing Athena results bucket.
    // Metabase will write its query results to s3://athena-results-bucket/metabase/
    const metabaseAthenaStagingPrefix = `s3://${athenaResultsBucketName}/metabase/`;

    // ─── 6. ECS Task IAM Roles ──────────────────────────────────────────────────

    // Execution role — allows ECS to pull image from ECR and read secrets
    const taskExecutionRole = new iam.Role(this, 'MetabaseTaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });
    metabaseDbSecret.grantRead(taskExecutionRole);
    metabaseRepo.grantPull(taskExecutionRole);

    // Task role — runtime IAM identity of the Metabase container
    const taskRole = new iam.Role(this, 'MetabaseTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    // Allow Metabase to read its own secret at runtime
    metabaseDbSecret.grantRead(taskRole);

    // Athena permissions
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'athena:StartQueryExecution',
        'athena:GetQueryExecution',
        'athena:GetQueryResults',
        'athena:StopQueryExecution',
        'athena:ListQueryExecutions',
        'athena:GetWorkGroup',
        'athena:ListWorkGroups',
      ],
      resources: ['*'],
    }));

    // S3 — Athena staging bucket (write query results)
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:PutObject', 's3:GetObject', 's3:ListBucket', 's3:DeleteObject'],
      resources: [
        `arn:aws:s3:::${athenaResultsBucketName}`,
        `arn:aws:s3:::${athenaResultsBucketName}/*`,
      ],
    }));

    // S3 — analytics data bucket (read reservation data)
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['s3:GetObject', 's3:ListBucket'],
      resources: [
        `arn:aws:s3:::${analyticsBucketName}`,
        `arn:aws:s3:::${analyticsBucketName}/*`,
      ],
    }));

    // Glue Data Catalog — for Athena schema discovery
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'glue:GetDatabase',
        'glue:GetDatabases',
        'glue:GetTable',
        'glue:GetTables',
        'glue:GetPartition',
        'glue:GetPartitions',
        'glue:BatchGetPartition',
      ],
      resources: ['*'],
    }));

    // ─── 7. ECS Task Definition ──────────────────────────────────────────────────
    const metabaseLogGroup = new logs.LogGroup(this, 'MetabaseLogs', {
      logGroupName: `/ecs/${CONFIG.projectName}/metabase`,
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const taskDefinition = new ecs.FargateTaskDefinition(this, 'MetabaseTaskDef', {
      cpu: 2048,       // 2 vCPU — Metabase is Java-based and needs headroom
      memoryLimitMiB: 4096,  // 4 GB
      executionRole: taskExecutionRole,
      taskRole,
    });

    // Inject Metabase DB config from Secrets Manager as individual env vars
    const container = taskDefinition.addContainer('MetabaseContainer', {
      // Pull from ECR mirror of metabase/metabase:latest
      image: ecs.ContainerImage.fromEcrRepository(metabaseRepo, 'latest'),
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'metabase',
        logGroup: metabaseLogGroup,
      }),
      portMappings: [{ containerPort: 3000, protocol: ecs.Protocol.TCP }],
      // Static env vars (non-secret)
      environment: {
        MB_DB_TYPE: 'mysql',
        MB_DB_PORT: '3306',
        MB_DB_DBNAME: 'metabase_db',
        MB_JETTY_PORT: '3000',
        JAVA_TIMEZONE: 'UTC',
        MB_SEND_EMAIL_ON_FIRST_LOGIN_FROM_NEW_DEVICE: 'false',
        MB_ANON_TRACKING_ENABLED: 'false',
      },
      // Secrets injected at runtime from Secrets Manager (not baked into image)
      secrets: {
        MB_DB_HOST: ecs.Secret.fromSecretsManager(metabaseDbSecret, 'host'),
        MB_DB_USER: ecs.Secret.fromSecretsManager(metabaseDbSecret, 'username'),
        MB_DB_PASS: ecs.Secret.fromSecretsManager(metabaseDbSecret, 'password'),
      },
      healthCheck: {
        // Metabase /api/health returns 200 when fully started
        command: ['CMD-SHELL', 'curl -f http://localhost:3000/api/health || exit 1'],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        retries: 5,
        // Metabase takes ~3 minutes to start on first launch (runs DB migrations)
        startPeriod: cdk.Duration.minutes(5),
      },
    });

    // ─── 8. ECS Fargate Service ──────────────────────────────────────────────────
    const metabaseService = new ecs.FargateService(this, 'MetabaseService', {
      cluster,
      taskDefinition,
      desiredCount: 1,
      securityGroups: [metabaseSg],
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      assignPublicIp: false,
      serviceName: `${CONFIG.projectName}-metabase`,
      // Enable ECS Exec for debugging
      enableExecuteCommand: true,
    });

    // Metabase init must complete before the service tries to connect to the DB
    metabaseService.node.addDependency(dbInitResource);

    // ─── 9. ALB Target Group + Listener Rule ─────────────────────────────────────
    const metabaseTg = new elbv2.ApplicationTargetGroup(this, 'MetabaseTg', {
      vpc,
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [metabaseService],
      targetGroupName: `${CONFIG.projectName}-metabase-tg`,
      healthCheck: {
        path: '/api/health',
        interval: cdk.Duration.seconds(30),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 5,  // More lenient — Metabase starts slowly
        timeout: cdk.Duration.seconds(10),
      },
      // Sticky sessions required — Metabase uses server-side sessions
      stickinessCookieDuration: cdk.Duration.days(1),
    });

    // Priority 30 — after search (10) and reservation (20) rules
    new elbv2.ApplicationListenerRule(this, 'MetabaseRule', {
      listener: albListener,
      priority: 30,
      // Host-header based routing so Metabase and the API coexist on the same ALB
      conditions: [
        elbv2.ListenerCondition.hostHeaders([`metabase.${CONFIG.projectName}.internal`]),
      ],
      targetGroups: [metabaseTg],
    });

    // ─── 10. Dedicated CloudFront Distribution for Metabase ──────────────────────
    // Separate distribution (not a behavior on the main one) for isolation.
    // Key differences from the main distribution:
    //   - CachingDisabled: Metabase is fully dynamic, caching breaks sessions
    //   - AllowedMethods: ALL (GET, HEAD, POST, PUT, DELETE, PATCH, OPTIONS)
    //   - Forward all cookies: Required for Metabase session management
    //   - Forward all headers: Required for CSRF protection

    // Custom cache policy — no caching, all headers/cookies forwarded
    const noCachePolicy = new cloudfront.CachePolicy(this, 'MetabaseNoCachePolicy', {
      cachePolicyName: `${CONFIG.projectName}-metabase-no-cache`,
      comment: 'No caching for Metabase (dynamic app with sessions)',
      defaultTtl: cdk.Duration.seconds(0),
      minTtl: cdk.Duration.seconds(0),
      maxTtl: cdk.Duration.seconds(0),
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList(
        'Host', 'Authorization', 'Content-Type', 'X-Metabase-Session'
      ),
      cookieBehavior: cloudfront.CacheCookieBehavior.all(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.all(),
    });

    // Origin request policy — forward everything to the ALB
    const allForwardPolicy = new cloudfront.OriginRequestPolicy(this, 'MetabaseOriginPolicy', {
      originRequestPolicyName: `${CONFIG.projectName}-metabase-all-forward`,
      comment: 'Forward all headers, cookies, and query strings to Metabase',
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList(
        'Host', 'User-Agent', 'Accept', 'Accept-Encoding',
        'Content-Type', 'Origin', 'Referer', 'X-Metabase-Session',
        'X-CSRF-Token',
      ),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
    });

    const metabaseDistribution = new cloudfront.Distribution(this, 'MetabaseDistribution', {
      comment: 'RoomHop Metabase BI Dashboard',
      // Reuse the same WAF WebACL for rate limiting + SQLi/XSS protection
      webAclId: wafAclArn,
      defaultBehavior: {
        origin: new cloudfrontOrigins.HttpOrigin(alb.loadBalancerDnsName, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY, // ALB is HTTP internally
          // Custom host header so ALB can distinguish Metabase traffic
          customHeaders: {
            'X-Forwarded-Host': `metabase.${CONFIG.projectName}.internal`,
          },
          httpPort: 80,
          connectionTimeout: cdk.Duration.seconds(10),
          readTimeout: cdk.Duration.seconds(60),  // Metabase queries can be slow
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: noCachePolicy,
        originRequestPolicy: allForwardPolicy,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        // Compress responses
        compress: true,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
    });

    this.metabaseUrl = `https://${metabaseDistribution.distributionDomainName}`;

    // ─── 11. Outputs ─────────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'MetabaseUrl', {
      value: this.metabaseUrl,
      description: 'Metabase CloudFront URL',
    });

    new cdk.CfnOutput(this, 'MetabaseDistributionId', {
      value: metabaseDistribution.distributionId,
      description: 'Metabase CloudFront distribution ID',
    });

    new cdk.CfnOutput(this, 'MetabaseDbSecretArn', {
      value: metabaseDbSecret.secretArn,
      description: 'Metabase DB credentials secret ARN',
    });

    new cdk.CfnOutput(this, 'MetabaseEcrRepo', {
      value: metabaseRepo.repositoryUri,
      description: 'ECR repo URI for Metabase image (mirror from Docker Hub)',
    });

    new cdk.CfnOutput(this, 'MetabaseAthenaStagingDir', {
      value: metabaseAthenaStagingPrefix,
      description: 'S3 staging directory for Metabase Athena queries',
    });
  }
}
