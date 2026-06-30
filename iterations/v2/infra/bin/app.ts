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
// TODO: Import OpenSearchStack and DmsStack for iteration 2
// import { OpenSearchStack } from '../lib/opensearch-stack';
// import { DmsStack } from '../lib/dms-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: CONFIG.region,
};

// Stack 1: Networking
const networkStack = new NetworkStack(app, 'RoomHop-V2-Network', { env });

// Stack 2: Database
const databaseStack = new DatabaseStack(app, 'RoomHop-V2-Database', {
  env,
  vpc: networkStack.vpc,
  securityGroups: networkStack.securityGroups,
});

// TODO: Stack 3: OpenSearch
// const opensearchStack = new OpenSearchStack(app, 'RoomHop-V2-OpenSearch', {
//   env,
//   vpc: networkStack.vpc,
//   securityGroups: networkStack.securityGroups,
// });

// TODO: Stack 4: DMS (CDC from RDS → OpenSearch)
// const dmsStack = new DmsStack(app, 'RoomHop-V2-DMS', {
//   env,
//   vpc: networkStack.vpc,
//   securityGroups: networkStack.securityGroups,
//   dbSecret: databaseStack.dbSecret,
//   dbEndpoint: databaseStack.dbEndpoint,
//   opensearchEndpoint: opensearchStack.domainEndpoint,
// });

// Stack 5: Compute — search queries OpenSearch in v2
const computeStack = new ComputeStack(app, 'RoomHop-V2-Compute', {
  env,
  vpc: networkStack.vpc,
  securityGroups: networkStack.securityGroups,
  dbSecret: databaseStack.dbSecret,
  dbEndpoint: databaseStack.dbEndpoint,
  opensearchEndpoint: 'TODO-opensearch-endpoint', // Will come from opensearchStack
});

// Stack 6: Authentication
const authStack = new AuthStack(app, 'RoomHop-V2-Auth', { env });

// Stack 7: API Gateway
const apiStack = new ApiStack(app, 'RoomHop-V2-Api', {
  env,
  vpc: networkStack.vpc,
  alb: computeStack.alb,
  albListener: computeStack.albListener,
  userPool: authStack.userPool,
  userPoolClient: authStack.userPoolClient,
});

// Stack 8: Frontend
const frontendStack = new FrontendStack(app, 'RoomHop-V2-Frontend', {
  env,
  apiEndpoint: apiStack.apiEndpoint,
});

// Stack 9: Events
const eventsStack = new EventsStack(app, 'RoomHop-V2-Events', {
  env,
  vpc: networkStack.vpc,
  securityGroups: networkStack.securityGroups,
});

// Stack 10: Analytics
const analyticsStack = new AnalyticsStack(app, 'RoomHop-V2-Analytics', {
  env,
  analyticsBucket: eventsStack.analyticsBucket,
});

app.synth();
