#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CONFIG } from '../lib/config';
import { NetworkStack } from '../lib/network-stack';
import { DatabaseStack } from '../lib/database-stack';
import { OpenSearchStack } from '../lib/opensearch-stack';
import { AuthStack } from '../lib/auth-stack';
import { EventsStack } from '../lib/events-stack';
import { ComputeStack } from '../lib/compute-stack';
import { ApiStack } from '../lib/api-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { AnalyticsStack } from '../lib/analytics-stack';
import { MetabaseStack } from '../lib/metabase-stack';
import { DmsStack } from '../lib/dms-stack';
import { ObservabilityStack } from '../lib/observability-stack';
import { PipelineStack } from '../lib/pipeline-stack';

const app = new cdk.App();
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: CONFIG.region };

const network = new NetworkStack(app, 'RoomHop-Network', { env });

const database = new DatabaseStack(app, 'RoomHop-Database', {
  env,
  vpc: network.vpc,
  securityGroups: network.securityGroups,
});

const openSearch = new OpenSearchStack(app, 'RoomHop-OpenSearch', {
  env,
  vpc: network.vpc,
  securityGroups: network.securityGroups,
});

const auth = new AuthStack(app, 'RoomHop-Auth', { env });
const events = new EventsStack(app, 'RoomHop-Events', { env });

const compute = new ComputeStack(app, 'RoomHop-Compute', {
  env,
  vpc: network.vpc,
  securityGroups: network.securityGroups,
  dbSecret: database.dbSecret,
  searchDomain: openSearch.domain,
  eventBus: events.eventBus,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
});

const api = new ApiStack(app, 'RoomHop-Api', {
  env,
  vpc: network.vpc,
  securityGroups: network.securityGroups,
  alb: compute.alb,
  albListener: compute.albListener,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
});

const frontend = new FrontendStack(app, 'RoomHop-Frontend', {
  env,
  apiEndpoint: api.apiEndpoint,
});

const analytics = new AnalyticsStack(app, 'RoomHop-Analytics', {
  env,
  analyticsBucket: events.analyticsBucket,
});

const metabase = new MetabaseStack(app, 'RoomHop-Metabase', {
  env,
  vpc: network.vpc,
  securityGroups: network.securityGroups,
  dbSecret: database.dbSecret,
  dbEndpoint: database.dbEndpoint,
  cluster: compute.cluster,
  alb: compute.alb,
  analyticsBucket: events.analyticsBucket,
  athenaResultsBucket: analytics.athenaResultsBucket,
  glueDatabaseName: analytics.glueDatabaseName,
  wafAclArn: frontend.wafAclArn,
});

const dms = new DmsStack(app, 'RoomHop-DMS', {
  env,
  vpc: network.vpc,
  securityGroups: network.securityGroups,
  dbSecret: database.dbSecret,
  opensearchEndpoint: openSearch.domainEndpoint,
  opensearchArn: openSearch.domainArn,
});

new ObservabilityStack(app, 'RoomHop-Observability', {
  env,
  httpApi: api.httpApi,
  cluster: compute.cluster,
  ecsServices: [
    { label: 'Search', service: compute.searchService },
    { label: 'Reservation', service: compute.reservationService },
    { label: 'Metabase', service: metabase.metabaseService },
  ],
  database: database.database,
  searchDomain: openSearch.domain,
  queues: [
    { label: 'Notification', queue: events.notificationQueue },
    { label: 'Analytics', queue: events.analyticsQueue },
  ],
  deadLetterQueues: [
    { label: 'Notification DLQ', queue: events.notificationDlq },
    { label: 'Analytics DLQ', queue: events.analyticsDlq },
  ],
  functions: [
    { label: 'Notification', function: events.notificationLambda },
    { label: 'Analytics', function: events.analyticsLambda },
    { label: 'DB migration', function: database.migrationLambda },
  ],
  dlqAlarms: [events.notificationDlqAlarm, events.analyticsDlqAlarm],
  replicationTask: dms.replicationTask,
  replicationInstance: dms.replicationInstance,
});

new PipelineStack(app, 'RoomHop-Pipeline', {
  env,
  searchRepository: compute.searchRepository,
  reservationRepository: compute.reservationRepository,
  collectorRepository: compute.collectorRepository,
  metabaseRepository: metabase.metabaseRepository,
  searchService: compute.searchService,
  reservationService: compute.reservationService,
  metabaseService: metabase.metabaseService,
  websiteBucket: frontend.websiteBucket,
  distribution: frontend.distribution,
  userPool: auth.userPool,
  userPoolClient: auth.userPoolClient,
});

app.synth();
