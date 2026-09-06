import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { NetworkStack } from '../lib/network-stack';
import { DatabaseStack } from '../lib/database-stack';
import { OpenSearchStack } from '../lib/opensearch-stack';
import { AuthStack } from '../lib/auth-stack';
import { EventsStack } from '../lib/events-stack';
import { ComputeStack } from '../lib/compute-stack';
import { ApiStack } from '../lib/api-stack';
import { DmsStack } from '../lib/dms-stack';
import { ObservabilityStack } from '../lib/observability-stack';

function coreStacks() {
  const app = new cdk.App();
  const env = { account: '111111111111', region: 'us-east-1' };
  const network = new NetworkStack(app, 'TestNetwork', { env });
  const database = new DatabaseStack(app, 'TestDatabase', {
    env,
    vpc: network.vpc,
    securityGroups: network.securityGroups,
  });
  const search = new OpenSearchStack(app, 'TestOpenSearch', {
    env,
    vpc: network.vpc,
    securityGroups: network.securityGroups,
  });
  const auth = new AuthStack(app, 'TestAuth', { env });
  const events = new EventsStack(app, 'TestEvents', { env });
  const compute = new ComputeStack(app, 'TestCompute', {
    env,
    vpc: network.vpc,
    securityGroups: network.securityGroups,
    dbSecret: database.dbSecret,
    searchDomain: search.domain,
    eventBus: events.eventBus,
    userPool: auth.userPool,
    userPoolClient: auth.userPoolClient,
  });
  const api = new ApiStack(app, 'TestApi', {
    env,
    vpc: network.vpc,
    securityGroups: network.securityGroups,
    alb: compute.alb,
    albListener: compute.albListener,
    userPool: auth.userPool,
    userPoolClient: auth.userPoolClient,
  });
  const dms = new DmsStack(app, 'TestDms', {
    env,
    vpc: network.vpc,
    securityGroups: network.securityGroups,
    dbSecret: database.dbSecret,
    opensearchEndpoint: search.domainEndpoint,
    opensearchArn: search.domainArn,
  });
  const observability = new ObservabilityStack(app, 'TestObservability', {
    env,
    httpApi: api.httpApi,
    cluster: compute.cluster,
    ecsServices: [
      { label: 'Search', service: compute.searchService },
      { label: 'Reservation', service: compute.reservationService },
    ],
    database: database.database,
    searchDomain: search.domain,
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
  return { network, database, search, events, compute, observability };
}

const stacks = coreStacks();

test('keeps exactly two private AZ subnets and no NAT gateway', () => {
  const { network } = stacks;
  const template = Template.fromStack(network);
  template.resourceCountIs('AWS::EC2::Subnet', 2);
  template.resourceCountIs('AWS::EC2::NatGateway', 0);
});

test('keeps RDS Single-AZ', () => {
  const { database } = stacks;
  const resources = Template.fromStack(database).findResources('AWS::RDS::DBInstance');
  assert.equal(Object.keys(resources).length, 1);
  assert.equal(Object.values(resources)[0].Properties.MultiAZ, false);
});

test('starts both application services with desiredCount one', () => {
  const { compute } = stacks;
  const resources = Template.fromStack(compute).findResources('AWS::ECS::Service');
  assert.equal(Object.keys(resources).length, 2);
  for (const service of Object.values(resources)) {
    assert.equal(service.Properties.DesiredCount, 1);
  }
});

test('uses one subnet for the single-node OpenSearch domain', () => {
  const { search } = stacks;
  const resources = Template.fromStack(search).findResources('AWS::OpenSearchService::Domain');
  assert.equal(Object.keys(resources).length, 1);
  assert.equal(Object.values(resources)[0].Properties.VPCOptions.SubnetIds.length, 1);
});

test('notification and analytics Lambdas are not attached to isolated subnets', () => {
  const { events } = stacks;
  const resources = Template.fromStack(events).findResources('AWS::Lambda::Function');
  const handlers = Object.values(resources).filter((fn) =>
    ['roomhop-notification-handler', 'roomhop-analytics-handler'].includes(fn.Properties.FunctionName),
  );
  assert.equal(handlers.length, 2);
  for (const fn of handlers) {
    assert.equal(fn.Properties.VpcConfig, undefined);
  }
});

test('allows ALB ingress only from the API Gateway VPC Link security group', () => {
  const template = Template.fromStack(stacks.network);
  const groups = template.findResources('AWS::EC2::SecurityGroup');
  const albEntry = Object.entries(groups).find(([, group]) =>
    group.Properties.GroupDescription === 'Security group for internal ALB',
  );
  const vpcLinkEntry = Object.entries(groups).find(([, group]) =>
    group.Properties.GroupDescription === 'Security group used only by API Gateway VPC Link ENIs',
  );
  assert.ok(albEntry && vpcLinkEntry);
  assert.equal(albEntry[1].Properties.SecurityGroupIngress, undefined);

  const albIngress = Object.values(template.findResources('AWS::EC2::SecurityGroupIngress'))
    .filter((rule) => JSON.stringify(rule.Properties.GroupId).includes(albEntry[0]));
  assert.deepEqual(albIngress.map((rule) => rule.Properties.FromPort).sort(), [80, 8080]);
  for (const rule of albIngress) {
    assert.deepEqual(
      rule.Properties.SourceSecurityGroupId,
      { 'Fn::GetAtt': [vpcLinkEntry[0], 'GroupId'] },
    );
    assert.equal(rule.Properties.CidrIp, undefined);
    assert.equal(rule.Properties.CidrIpv6, undefined);
  }
});

test('alerts the operations email when either DLQ contains a message', () => {
  const template = Template.fromStack(stacks.events);
  template.resourceCountIs('AWS::SNS::Topic', 1);
  template.resourceCountIs('AWS::SNS::Subscription', 1);
  template.resourceCountIs('AWS::CloudWatch::Alarm', 2);
  template.hasResourceProperties('AWS::SNS::Subscription', {
    Protocol: 'email',
    Endpoint: 'thenewpretender76@outlook.com',
  });

  const alarms = Object.values(template.findResources('AWS::CloudWatch::Alarm'));
  for (const alarm of alarms) {
    assert.equal(alarm.Properties.MetricName, 'ApproximateNumberOfMessagesVisible');
    assert.equal(alarm.Properties.Namespace, 'AWS/SQS');
    assert.equal(alarm.Properties.Threshold, 1);
    assert.equal(alarm.Properties.EvaluationPeriods, 1);
    assert.equal(alarm.Properties.DatapointsToAlarm, 1);
    assert.equal(alarm.Properties.TreatMissingData, 'notBreaching');
    assert.equal(alarm.Properties.AlarmActions.length, 1);
  }
});

test('creates one cross-service operations dashboard without duplicating application resources', () => {
  const template = Template.fromStack(stacks.observability);
  template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
  template.hasResourceProperties('AWS::CloudWatch::Dashboard', {
    DashboardName: 'roomhop-operations',
  });

  const dashboards = Object.values(template.findResources('AWS::CloudWatch::Dashboard'));
  const body = JSON.stringify(dashboards[0].Properties.DashboardBody);
  for (const expected of [
    'AWS/ApiGateway',
    'AWS/ECS',
    'ECS/ContainerInsights',
    'AWS/RDS',
    'AWS/ES',
    'AWS/SQS',
    'AWS/Lambda',
    'AWS/DMS',
    'API error rate (%)',
    'Total visible DLQ messages',
    'singleValue',
    'RoomHop Operations',
  ]) {
    assert.match(body, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(body, /dlq0 \+ dlq1/);

  for (const resourceType of [
    'AWS::ApiGatewayV2::Api',
    'AWS::ECS::Service',
    'AWS::RDS::DBInstance',
    'AWS::OpenSearchService::Domain',
    'AWS::SQS::Queue',
    'AWS::DMS::ReplicationTask',
  ]) {
    template.resourceCountIs(resourceType, 0);
  }

  const functionNames = Object.values(template.findResources('AWS::Lambda::Function'))
    .map((fn) => fn.Properties.FunctionName)
    .filter(Boolean);
  assert.equal(functionNames.some((name) => [
    'roomhop-notification-handler',
    'roomhop-analytics-handler',
    'roomhop-db-migration',
  ].includes(name)), false);
});

test('reuses one private X-Ray endpoint with ECS-only HTTPS ingress', () => {
  const template = Template.fromStack(stacks.network);
  const endpoints = Object.values(template.findResources('AWS::EC2::VPCEndpoint'));
  const xrayEndpoints = endpoints.filter((endpoint) =>
    JSON.stringify(endpoint.Properties.ServiceName).includes('.xray'),
  );
  assert.equal(xrayEndpoints.length, 1);
  assert.match(JSON.stringify(xrayEndpoints[0].Properties.PolicyDocument), /xray:PutTraceSegments/);

  const groups = template.findResources('AWS::EC2::SecurityGroup');
  const ecsEntry = Object.entries(groups).find(([, group]) =>
    group.Properties.GroupDescription === 'Security group for ECS Fargate tasks',
  );
  const xrayEntry = Object.entries(groups).find(([, group]) =>
    group.Properties.GroupDescription === 'Security group dedicated to the X-Ray VPC endpoint',
  );
  assert.ok(ecsEntry && xrayEntry);
  assert.equal(xrayEntry[1].Properties.SecurityGroupIngress, undefined);
  const ingressRules = Object.values(template.findResources('AWS::EC2::SecurityGroupIngress'));
  const xrayIngress = ingressRules.find((rule) =>
    JSON.stringify(rule.Properties.GroupId).includes(xrayEntry[0]),
  );
  assert.ok(xrayIngress);
  assert.equal(xrayIngress.Properties.IpProtocol, 'tcp');
  assert.equal(xrayIngress.Properties.FromPort, 443);
  assert.equal(xrayIngress.Properties.ToPort, 443);
  assert.deepEqual(
    xrayIngress.Properties.SourceSecurityGroupId,
    { 'Fn::GetAtt': [ecsEntry[0], 'GroupId'] },
  );
  assert.equal(xrayIngress.Properties.CidrIp, undefined);
});

test('uses one non-essential ADOT collector per task and removes the X-Ray daemon', () => {
  const template = Template.fromStack(stacks.compute);
  const taskDefinitions = Object.values(template.findResources('AWS::ECS::TaskDefinition'));
  assert.equal(taskDefinitions.length, 2);
  const containers = taskDefinitions.flatMap((task) => task.Properties.ContainerDefinitions);
  assert.deepEqual(
    containers.filter((container) => /AdotCollector$/.test(container.Name)).map((container) => container.Name).sort(),
    ['ReservationAdotCollector', 'SearchAdotCollector'],
  );
  assert.equal(containers.some((container) => /xray|daemon/i.test(container.Name)), false);

  for (const collector of containers.filter((container) => /AdotCollector$/.test(container.Name))) {
    assert.equal(collector.Essential, false);
    assert.equal(collector.PortMappings[0].ContainerPort, 4318);
    assert.equal(collector.PortMappings[0].Protocol, 'tcp');
    assert.deepEqual(collector.HealthCheck.Command, ['CMD-SHELL', '/healthcheck']);
  }

  for (const application of containers.filter((container) => /Container$/.test(container.Name))) {
    const environment = Object.fromEntries(
      application.Environment.map((entry: { Name: string; Value: string }) => [entry.Name, entry.Value]),
    );
    assert.equal(environment.TRACING_ENABLED, 'true');
    assert.equal(environment.DEPLOYMENT_ENVIRONMENT, 'prod');
    assert.equal(environment.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, 'http://127.0.0.1:4318/v1/traces');
    assert.equal(environment.OTEL_TRACES_SAMPLER, 'parentbased_traceidratio');
    assert.equal(environment.OTEL_TRACES_SAMPLER_ARG, '0.1');
    assert.equal(application.DependsOn, undefined);
  }
});

test('grants only X-Ray trace ingestion to ECS task roles', () => {
  const template = Template.fromStack(stacks.compute);
  const policies = Object.values(template.findResources('AWS::IAM::Policy'));
  const xrayStatements = policies.flatMap((policy) => {
    const statement = policy.Properties.PolicyDocument.Statement;
    return (Array.isArray(statement) ? statement : [statement]).filter((entry) =>
      JSON.stringify(entry.Action).includes('xray:'),
    );
  });
  assert.equal(xrayStatements.length, 2);
  for (const statement of xrayStatements) {
    assert.deepEqual(statement.Action, 'xray:PutTraceSegments');
    assert.equal(statement.Resource, '*');
  }
  const managedPolicies = Object.values(template.findResources('AWS::IAM::Role'))
    .flatMap((role) => role.Properties.ManagedPolicyArns || []);
  assert.equal(JSON.stringify(managedPolicies).includes('AWSXRayDaemonWriteAccess'), false);
});

test('creates the private ADOT collector repository', () => {
  const template = Template.fromStack(stacks.compute);
  const repositories = Object.values(template.findResources('AWS::ECR::Repository'));
  assert.ok(repositories.some((repository) =>
    repository.Properties.RepositoryName === 'roomhop/adot-collector',
  ));
});
