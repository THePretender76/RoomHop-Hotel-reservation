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

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: CONFIG.region,
};

// Stack 1: Networking
const networkStack = new NetworkStack(app, 'RoomHop-V1-Network', { env });

// Stack 2: Database
const databaseStack = new DatabaseStack(app, 'RoomHop-V1-Database', {
  env,
  vpc: networkStack.vpc,
  securityGroups: networkStack.securityGroups,
});

// Stack 3: Compute — search queries MySQL directly (no OpenSearch)
const computeStack = new ComputeStack(app, 'RoomHop-V1-Compute', {
  env,
  vpc: networkStack.vpc,
  securityGroups: networkStack.securityGroups,
  dbSecret: databaseStack.dbSecret,
  dbEndpoint: databaseStack.dbEndpoint,
  opensearchEndpoint: 'not-used',
});

// Stack 4: Authentication
const authStack = new AuthStack(app, 'RoomHop-V1-Auth', { env });

// Stack 5: API Gateway
const apiStack = new ApiStack(app, 'RoomHop-V1-Api', {
  env,
  vpc: networkStack.vpc,
  alb: computeStack.alb,
  albListener: computeStack.albListener,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
});

// Stack 6: Frontend
const frontendStack = new FrontendStack(app, 'RoomHop-V1-Frontend', {
  env,
  apiEndpoint: apiStack.apiEndpoint,
});

// Stack 7: Events
const eventsStack = new EventsStack(app, 'RoomHop-V1-Events', {
  env,
  vpc: networkStack.vpc,
  securityGroups: networkStack.securityGroups,
});

// Stack 8: Analytics
const analyticsStack = new AnalyticsStack(app, 'RoomHop-V1-Analytics', {
  env,
  analyticsBucket: eventsStack.analyticsBucket,
});

app.synth();
