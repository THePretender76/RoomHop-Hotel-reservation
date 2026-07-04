#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CONFIG } from '../lib/config';
import { NetworkStack } from '../lib/network-stack';
import { DatabaseStack } from '../lib/database-stack';
import { ComputeStack } from '../lib/compute-stack';
import { AuthStack } from '../lib/auth-stack';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { EventsStack } from '../lib/events-stack';
import { AnalyticsStack } from '../lib/analytics-stack';
import { ObservabilityStack } from '../lib/observability-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: CONFIG.region,
};

// Stack 1: Networking (VPC, Subnets, Endpoints, Security Groups)
const networkStack = new NetworkStack(app, 'RoomHop-Network', { env });

// Stack 2: Database (RDS Single-AZ, Secrets Manager)
const databaseStack = new DatabaseStack(app, 'RoomHop-Database', {
  env,
  vpc: networkStack.vpc,
  securityGroups: networkStack.securityGroups,
});

// Stack 3: Compute (ECS Fargate, ALB, ECR) — search queries MySQL directly
const computeStack = new ComputeStack(app, 'RoomHop-Compute', {
  env,
  vpc: networkStack.vpc,
  securityGroups: networkStack.securityGroups,
  dbSecret: databaseStack.dbSecret,
  dbEndpoint: databaseStack.dbEndpoint,
  opensearchEndpoint: 'not-used', // OpenSearch skipped in iteration 1
});

// Stack 5: Authentication (Cognito)
const authStack = new AuthStack(app, 'RoomHop-Auth', { env });

// Stack 6: API Gateway (HTTP API, VPC Link, JWT Authorizer)
const apiStack = new ApiStack(app, 'RoomHop-Api', {
  env,
  vpc: networkStack.vpc,
  alb: computeStack.alb,
  albListener: computeStack.albListener,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
});

// Stack 7: Frontend (S3, CloudFront, WAF)
const frontendStack = new FrontendStack(app, 'RoomHop-Frontend', {
  env,
  apiEndpoint: apiStack.apiEndpoint,
});

// Stack 8: Events (EventBridge, SQS, Lambda for notifications + analytics)
const eventsStack = new EventsStack(app, 'RoomHop-Events', {
  env,
  vpc: networkStack.vpc,
  securityGroups: networkStack.securityGroups,
});

// Stack 9: Analytics (S3 data lake, Athena)
const analyticsStack = new AnalyticsStack(app, 'RoomHop-Analytics', {
  env,
  analyticsBucket: eventsStack.analyticsBucket,
});

// Stack 10: Observability (CloudTrail, IAM Access Analyzer)
new ObservabilityStack(app, 'RoomHop-Observability', { env });

app.synth();
