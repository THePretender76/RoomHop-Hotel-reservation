#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CONFIG } from '../lib/config';
import { NetworkStack } from '../lib/network-stack';
import { DatabaseStack } from '../lib/database-stack';
import { OpenSearchStack } from '../lib/opensearch-stack';
import { DmsStack } from '../lib/dms-stack';
import { ComputeStack } from '../lib/compute-stack';
import { AuthStack } from '../lib/auth-stack';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { EventsStack } from '../lib/events-stack';
import { AnalyticsStack } from '../lib/analytics-stack';
import { MetabaseStack } from '../lib/metabase-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: CONFIG.region,
};

// Stack 1: Networking
const networkStack = new NetworkStack(app, 'RoomHop-V2-Network', { env });

// Stack 2: Database (RDS + migration Lambda)
const databaseStack = new DatabaseStack(app, 'RoomHop-V2-Database', {
  env,
  vpc: networkStack.vpc,
  securityGroups: networkStack.securityGroups,
});

// Stack 3: OpenSearch
const opensearchStack = new OpenSearchStack(app, 'RoomHop-V2-OpenSearch', {
  env,
  vpc: networkStack.vpc,
  securityGroups: networkStack.securityGroups,
});

// Stack 4: DMS CDC (RDS → OpenSearch)
const dmsStack = new DmsStack(app, 'RoomHop-V2-DMS', {
  env,
  vpc: networkStack.vpc,
  securityGroups: networkStack.securityGroups,
  dbSecret: databaseStack.dbSecret,
  dbEndpoint: databaseStack.dbEndpoint,
  opensearchEndpoint: opensearchStack.domainEndpoint,
  opensearchArn: opensearchStack.domainArn,
});

// Stack 5: Compute (ECS cluster, search + reservation services, ALB)
const computeStack = new ComputeStack(app, 'RoomHop-V2-Compute', {
  env,
  vpc: networkStack.vpc,
  securityGroups: networkStack.securityGroups,
  dbSecret: databaseStack.dbSecret,
  dbEndpoint: databaseStack.dbEndpoint,
  opensearchEndpoint: opensearchStack.domainEndpoint,
});

// Stack 6: Authentication (Cognito)
const authStack = new AuthStack(app, 'RoomHop-V2-Auth', { env });

// Stack 7: API Gateway (HTTP API + JWT + VPC Link)
const apiStack = new ApiStack(app, 'RoomHop-V2-Api', {
  env,
  vpc: networkStack.vpc,
  alb: computeStack.alb,
  albListener: computeStack.albListener,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
});

// Stack 8: Frontend (S3, CloudFront, WAF)
const frontendStack = new FrontendStack(app, 'RoomHop-V2-Frontend', {
  env,
  apiEndpoint: apiStack.apiEndpoint,
});

// Stack 9: Events (EventBridge, SQS, Lambdas)
const eventsStack = new EventsStack(app, 'RoomHop-V2-Events', {
  env,
  vpc: networkStack.vpc,
  securityGroups: networkStack.securityGroups,
});

// Stack 10: Analytics (Glue, Athena, S3 data lake)
const analyticsStack = new AnalyticsStack(app, 'RoomHop-V2-Analytics', {
  env,
  analyticsBucket: eventsStack.analyticsBucket,
});

// Stack 11: Metabase (BI dashboard — ECS Fargate + dedicated CloudFront + Athena access)
// Depends on: Compute (cluster + ALB), Database (RDS), Analytics (Athena + Glue), Frontend (WAF)
new MetabaseStack(app, 'RoomHop-V2-Metabase', {
  env,
  vpc: networkStack.vpc,
  securityGroups: networkStack.securityGroups,
  dbSecret: databaseStack.dbSecret,
  dbEndpoint: databaseStack.dbEndpoint,
  cluster: computeStack.cluster,
  albListener: computeStack.albListener,
  alb: computeStack.alb,
  athenaResultsBucketName: analyticsStack.athenaResultsBucketName,
  analyticsBucketName: eventsStack.analyticsBucket.bucketName,
  glueDatabaseName: analyticsStack.glueDatabaseName,
  wafAclArn: frontendStack.wafAclArn,
});

app.synth();
