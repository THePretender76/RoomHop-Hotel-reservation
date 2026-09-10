import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { NetworkStack } from '../lib/network-stack';
import { DatabaseStack } from '../lib/database-stack';
import { OpenSearchStack } from '../lib/opensearch-stack';
import { AuthStack } from '../lib/auth-stack';
import { EventsStack } from '../lib/events-stack';
import { ComputeStack } from '../lib/compute-stack';
import { FrontendStack } from '../lib/frontend-stack';
import { AnalyticsStack } from '../lib/analytics-stack';
import { MetabaseStack } from '../lib/metabase-stack';
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
  const frontend = new FrontendStack(app, 'TestFrontend', { env, alb: compute.alb });
  frontend.addStackDependency(network);
  frontend.addStackDependency(compute);
  const analytics = new AnalyticsStack(app, 'TestAnalytics', { env, analyticsBucket: events.analyticsBucket });
  const metabase = new MetabaseStack(app, 'TestMetabase', {
    env,
    vpc: network.vpc,
    securityGroups: network.securityGroups,
    alb: compute.alb,
    albListener: compute.albListener,
    dbSecret: database.dbSecret,
    dbEndpoint: database.dbEndpoint,
    cluster: compute.cluster,
    analyticsBucket: events.analyticsBucket,
    athenaResultsBucket: analytics.athenaResultsBucket,
    athenaWorkgroupName: analytics.athenaWorkgroup.name,
    glueDatabaseName: analytics.glueDatabaseName,
    cloudFrontUrl: frontend.cloudFrontUrl,
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
    alb: compute.alb,
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
  return { network, database, search, events, compute, observability, frontend, metabase, analytics, auth };
}

const stacks = coreStacks();

test('crawler follows only the existing reservations table location and preserves its schema', () => {
  const template = Template.fromStack(stacks.analytics);
  template.resourceCountIs('AWS::Glue::Database', 1);
  template.resourceCountIs('AWS::Glue::Table', 1);
  template.resourceCountIs('AWS::Glue::Crawler', 1);
  const [tableId, table] = Object.entries(template.findResources('AWS::Glue::Table'))[0];
  const [dbId, database] = Object.entries(template.findResources('AWS::Glue::Database'))[0];
  const crawler = Object.values(template.findResources('AWS::Glue::Crawler'))[0].Properties;
  assert.equal(database.Properties.DatabaseInput.Name, 'roomhop_analytics');
  assert.equal(table.Properties.TableInput.Name, 'reservations');
  assert.deepEqual(crawler.Targets, { CatalogTargets: [{ DatabaseName: { Ref: dbId }, Tables: [{ Ref: tableId }] }] });
  assert.deepEqual(crawler.DatabaseName, { Ref: dbId });
  const schema = table.Properties.TableInput;
  assert.deepEqual(schema.StorageDescriptor.Location,
    stacks.analytics.resolve(`s3://${stacks.events.analyticsBucket.bucketName}/reservations/`));
  assert.deepEqual(schema.PartitionKeys, ['year', 'month', 'day'].map(Name => ({ Name, Type: 'string' })));
  assert.equal(schema.Parameters['projection.enabled'], 'false');
  assert.equal(schema.Parameters.classification, 'json');
  assert.equal(schema.StorageDescriptor.SerdeInfo.SerializationLibrary, 'org.openx.data.jsonserde.JsonSerDe');
  assert.equal(schema.StorageDescriptor.Columns.length, 12);
  assert.equal(schema.StorageDescriptor.Columns.find((column: any) => column.Name === 'totalAmount').Type, 'double');
  assert.deepEqual(crawler.SchemaChangePolicy, { UpdateBehavior: 'LOG', DeleteBehavior: 'LOG' });
  assert.deepEqual(JSON.parse(crawler.Configuration).CrawlerOutput.Partitions, { AddOrUpdateBehavior: 'InheritFromTable' });
  assert.equal(crawler.Classifiers, undefined);
  assert.equal(crawler.Schedule, undefined); // The single schedule lives in EventBridge Scheduler.
});

test('crawler role reads only reservation objects and cannot delete catalog metadata or write data', () => {
  const template = Template.fromStack(stacks.analytics);
  const [roleId, role] = Object.entries(template.findResources('AWS::IAM::Role'))
    .find(([id]) => id.startsWith('ReservationCrawlerRole'))!;
  assert.equal(role.Properties.AssumeRolePolicyDocument.Statement[0].Principal.Service, 'glue.amazonaws.com');
  const policy = Object.values(template.findResources('AWS::IAM::Policy'))
    .find(resource => resource.Properties.Roles.some((r: any) => r.Ref === roleId))!;
  const statements = policy.Properties.PolicyDocument.Statement;
  const actions = (statement: any): string[] => [statement.Action].flat();
  for (const statement of statements) {
    assert.ok(![statement.Resource].flat().includes('*'));
    for (const action of actions(statement)) {
      assert.ok(!action.includes('*'), `unexpected wildcard action ${action}`);
      assert.ok(!/^glue:(?:Delete|BatchDelete|CreateTable|CreateDatabase)/.test(action));
      if (action.startsWith('s3:')) {
        assert.ok(['s3:GetBucketLocation', 's3:ListBucket', 's3:GetObject'].includes(action));
      }
    }
  }
  assert.deepEqual(statements.find((s: any) => actions(s).includes('s3:GetObject')).Resource,
    stacks.analytics.resolve(stacks.events.analyticsBucket.arnForObjects('reservations/*')));
  assert.deepEqual(statements.find((s: any) => actions(s).includes('s3:ListBucket')).Condition,
    { StringLike: { 's3:prefix': ['reservations', 'reservations/*'] } });
  const metadata = statements.find((s: any) => actions(s).includes('glue:BatchCreatePartition'));
  assert.equal(metadata.Resource.length, 3); // catalog, database and this table only
  assert.match(JSON.stringify(metadata.Resource), /ReservationsTable/);
  const logs = statements.find((s: any) => actions(s).includes('logs:PutLogEvents'));
  assert.match(JSON.stringify(logs.Resource), /\/aws-glue\/crawlers:log-stream:roomhop-reservation-crawler/);
  const crawler = Object.values(template.findResources('AWS::Glue::Crawler'))[0];
  assert.ok(crawler.DependsOn.includes(roleId));
  assert.ok(crawler.DependsOn.some((id: string) => id.includes('DefaultPolicy')));
});

test('hourly scheduler can only start this crawler and bounds retries before the next hour', () => {
  const template = Template.fromStack(stacks.analytics);
  template.resourceCountIs('AWS::Scheduler::Schedule', 1);
  const [crawlerId] = Object.keys(template.findResources('AWS::Glue::Crawler'));
  const scheduleResource = Object.values(template.findResources('AWS::Scheduler::Schedule'))[0];
  const schedule = scheduleResource.Properties;
  assert.equal(schedule.ScheduleExpression, 'rate(1 hour)');
  assert.deepEqual(schedule.FlexibleTimeWindow, { Mode: 'OFF' });
  assert.match(JSON.stringify(schedule.Target.Arn), /aws-sdk:glue:startCrawler/);
  assert.deepEqual(schedule.Target.Input, stacks.analytics.resolve(stacks.analytics.toJsonString({ Name: stacks.analytics.reservationCrawler.ref })));
  assert.deepEqual(schedule.Target.RetryPolicy, { MaximumEventAgeInSeconds: 900, MaximumRetryAttempts: 1 });
  const roleId = schedule.Target.RoleArn['Fn::GetAtt'][0];
  assert.ok(scheduleResource.DependsOn.includes(roleId));
  assert.ok(scheduleResource.DependsOn.some((id: string) => id.includes('DefaultPolicy')));
  const role = template.findResources('AWS::IAM::Role')[roleId];
  const trust = role.Properties.AssumeRolePolicyDocument.Statement[0];
  assert.equal(trust.Principal.Service, 'scheduler.amazonaws.com');
  assert.ok(trust.Condition.StringEquals['aws:SourceAccount']);
  assert.match(JSON.stringify(trust.Condition.StringEquals['aws:SourceArn']), /schedule-group\/default/);
  const policy = Object.values(template.findResources('AWS::IAM::Policy'))
    .find(resource => resource.Properties.Roles.some((r: any) => r.Ref === roleId))!;
  const statements = policy.Properties.PolicyDocument.Statement;
  assert.equal(statements.length, 1);
  assert.deepEqual([statements[0].Action].flat(), ['glue:StartCrawler']);
  assert.deepEqual(statements[0].Resource, stacks.analytics.resolve(stacks.analytics.formatArn({
    service: 'glue', resource: 'crawler', resourceName: stacks.analytics.reservationCrawler.ref,
  })));
  assert.match(JSON.stringify(statements[0].Resource), new RegExp(crawlerId));
});

test('crawler reuses private buckets and Athena configuration without adding networking', () => {
  const template = Template.fromStack(stacks.analytics);
  template.resourceCountIs('AWS::S3::Bucket', 1); // Existing Athena results bucket only.
  template.resourceCountIs('AWS::Athena::WorkGroup', 1);
  template.resourceCountIs('AWS::EC2::NatGateway', 0);
  template.resourceCountIs('AWS::EC2::VPCEndpoint', 0);
  const bucket = Object.values(template.findResources('AWS::S3::Bucket'))[0].Properties;
  assert.equal(Object.values(bucket.PublicAccessBlockConfiguration).every(Boolean), true);
  assert.ok(bucket.BucketEncryption);
  assert.equal(bucket.WebsiteConfiguration, undefined);
  const workgroup = Object.values(template.findResources('AWS::Athena::WorkGroup'))[0].Properties;
  assert.equal(workgroup.Name, 'roomhop-analytics');
  assert.equal(workgroup.WorkGroupConfiguration.EnforceWorkGroupConfiguration, true);
  assert.deepEqual(workgroup.WorkGroupConfiguration.ResultConfiguration.OutputLocation,
    stacks.analytics.resolve(`s3://${stacks.analytics.athenaResultsBucket.bucketName}/query-results/`));
});

test('Metabase can discover metadata and stream query results with scoped data access', () => {
  const template = Template.fromStack(stacks.metabase);
  const policy = Object.entries(template.findResources('AWS::IAM::Policy'))
    .find(([id]) => id.startsWith('MetabaseTaskRoleDefaultPolicy'))![1];
  const statements = policy.Properties.PolicyDocument.Statement;
  const actions = (statement: any): string[] => [statement.Action].flat();
  const query = statements.find((s: any) => actions(s).includes('athena:StartQueryExecution'));
  assert.ok(actions(query).includes('athena:GetQueryResultsStream'));
  assert.match(JSON.stringify(query.Resource), /workgroup\/roomhop-analytics/);
  assert.match(JSON.stringify(statements.find((s: any) => actions(s).includes('athena:ListTableMetadata')).Resource), /datacatalog\/AwsDataCatalog/);
  const metadata = statements.find((s: any) => actions(s).includes('glue:GetTables'));
  assert.ok(actions(metadata).includes('glue:BatchGetPartition'));
  assert.ok(actions(metadata).every(action => /^glue:(Get|BatchGet)/.test(action)));
  assert.ok(!metadata.Resource.includes('*'));
  assert.match(JSON.stringify(metadata.Resource), /reservations/);
  const s3Statements = statements.filter((s: any) => actions(s).some(action => action.startsWith('s3:')));
  assert.ok(s3Statements.every((s: any) => !actions(s).some(action => /Delete|\*/.test(action))));
  const sourceRead = s3Statements.find((s: any) => actions(s).includes('s3:GetObject') && !actions(s).includes('s3:PutObject'));
  assert.deepEqual(sourceRead.Resource, stacks.metabase.resolve(stacks.events.analyticsBucket.arnForObjects('reservations/*')));
  const resultsWrite = s3Statements.find((s: any) => actions(s).includes('s3:PutObject'));
  assert.deepEqual(resultsWrite.Resource, stacks.metabase.resolve(stacks.analytics.athenaResultsBucket.arnForObjects('query-results/*')));
});

test('uses one existing CloudFront distribution with OAC, WAF and a single private ALB origin', () => {
  const template = Template.fromStack(stacks.frontend);
  template.resourceCountIs('AWS::CloudFront::Distribution', 1);
  template.resourceCountIs('AWS::CloudFront::VpcOrigin', 1);
  template.resourceCountIs('AWS::CloudFront::OriginAccessControl', 2);
  const config = Object.values(template.findResources('AWS::CloudFront::Distribution'))[0]
    .Properties.DistributionConfig;
  assert.ok(config.WebACLId);
  assert.equal(config.Origins.length, 3);
  const vpcOrigin = config.Origins.find((origin: any) => origin.VpcOriginConfig);
  assert.ok(vpcOrigin);
  const behaviors = config.CacheBehaviors.filter((behavior: any) =>
    ['v1/*', 'analytics/*', 'analytics'].includes(behavior.PathPattern));
  assert.equal(behaviors.length, 3);
  for (const behavior of behaviors) {
    assert.equal(behavior.TargetOriginId, vpcOrigin.Id);
    assert.deepEqual([...behavior.AllowedMethods].sort(), ['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT']);
    // AWS-managed CachingDisabled and AllViewerExceptHostHeader. The latter
    // forwards Authorization, every other viewer header, cookies and queries.
    assert.equal(behavior.CachePolicyId, '4135ea2d-6df8-44a3-9df3-4b5a84be39ad');
    assert.equal(behavior.OriginRequestPolicyId, 'b689b0a8-53d0-40ab-baf2-68738e2966ac');
  }
  assert.equal(behaviors.find((b: any) => b.PathPattern === 'v1/*').FunctionAssociations, undefined);
  assert.equal(config.CustomErrorResponses, undefined);
  for (const bucket of Object.values(template.findResources('AWS::S3::Bucket'))) {
    assert.equal(bucket.Properties.WebsiteConfiguration, undefined);
    assert.equal(Object.values(bucket.Properties.PublicAccessBlockConfiguration).every(Boolean), true);
  }
  const endpoint = Object.values(template.findResources('AWS::CloudFront::VpcOrigin'))[0]
    .Properties.VpcOriginEndpointConfig;
  assert.equal(endpoint.HTTPPort, 80);
  assert.equal(endpoint.OriginProtocolPolicy, 'http-only');
  assert.match(JSON.stringify(endpoint.Arn), /InternalAlb/);
  const redirectCode = Object.entries(template.findResources('AWS::CloudFront::Function'))
    .find(([id]) => id.startsWith('AnalyticsRedirectFunction'))![1].Properties.FunctionCode;
  const redirect = runInNewContext(`${redirectCode}; handler(event)`, {
    event: { request: { querystring: {
      returnTo: { value: '%2Fdashboard%2F1' },
      filter: { multiValue: [{ value: 'a' }, { value: 'b' }] },
    } } },
  });
  assert.equal(redirect.statusCode, 308);
  assert.equal(redirect.headers.location.value, '/analytics/?returnTo=%2Fdashboard%2F1&filter=a&filter=b');
});

test('removes every API Gateway and VPC Link, preserves private compute and reuses the ALB routes', () => {
  for (const stack of Object.values(stacks)) {
    const template = Template.fromStack(stack);
    for (const resource of Object.values(template.toJSON().Resources) as any[]) {
      assert.equal(resource.Type.startsWith('AWS::ApiGateway'), false);
    }
  }
  const compute = Template.fromStack(stacks.compute);
  compute.resourceCountIs('AWS::ElasticLoadBalancingV2::LoadBalancer', 1);
  compute.hasResourceProperties('AWS::ElasticLoadBalancingV2::LoadBalancer', { Scheme: 'internal' });
  const paths = Object.values(compute.findResources('AWS::ElasticLoadBalancingV2::ListenerRule'))
    .flatMap((rule) => rule.Properties.Conditions.flatMap((condition: any) => condition.PathPatternConfig?.Values || []));
  assert.deepEqual(paths.sort(), ['/v1/admin*', '/v1/reservations*', '/v1/search*']);
  const metabase = Template.fromStack(stacks.metabase);
  metabase.resourceCountIs('AWS::CloudFront::Distribution', 0);
  metabase.resourceCountIs('AWS::ElasticLoadBalancingV2::Listener', 0);
  metabase.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
    Priority: 30,
    Transforms: [{ Type: 'url-rewrite', UrlRewriteConfig: { Rewrites: [{ Regex: '^/analytics/(.*)$', Replace: '/$1' }] } }],
  });
  for (const template of [compute, metabase]) {
    for (const service of Object.values(template.findResources('AWS::ECS::Service'))) {
      assert.equal(service.Properties.NetworkConfiguration.AwsvpcConfiguration.AssignPublicIp, 'DISABLED');
    }
  }
  const network = Template.fromStack(stacks.network);
  network.resourceCountIs('AWS::EC2::InternetGateway', 1);
  network.resourceCountIs('AWS::EC2::VPCGatewayAttachment', 1);
  network.resourceCountIs('AWS::EC2::Route', 0);
  for (const subnet of Object.values(network.findResources('AWS::EC2::Subnet'))) {
    assert.equal(subnet.Properties.MapPublicIpOnLaunch, false);
  }
});

test('retains the legacy VPC Link SG export only during the documented first deployment', () => {
  const app = new cdk.App({ context: { retainLegacyIngress: 'true' } });
  const network = new NetworkStack(app, 'MigrationNetwork', { env: { account: '111111111111', region: 'us-east-1' } });
  const template = Template.fromStack(network).toJSON();
  const oldGroup = Object.keys(template.Resources).find((id) => id.startsWith('VpcLinkSg'));
  assert.ok(oldGroup);
  assert.ok(Object.values(template.Outputs).some((output: any) => output.Export && JSON.stringify(output.Value).includes(oldGroup)));
});

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

test('allows ALB ingress only from the supplied CloudFront managed prefix list on port 80', () => {
  const template = Template.fromStack(stacks.network);
  const groups = template.findResources('AWS::EC2::SecurityGroup');
  const albEntry = Object.entries(groups).find(([, group]) =>
    group.Properties.GroupDescription === 'Security group for internal ALB',
  );
  assert.ok(albEntry);
  assert.equal(Object.keys(groups).some((id) => id.startsWith('VpcLinkSg')), false);
  const albIngress = [
    ...(albEntry[1].Properties.SecurityGroupIngress || []),
    ...Object.values(template.findResources('AWS::EC2::SecurityGroupIngress'))
      .filter((rule) => JSON.stringify(rule.Properties.GroupId).includes(albEntry[0]))
      .map((rule) => rule.Properties),
  ];
  assert.deepEqual(albIngress.map((rule) => rule.FromPort), [80]);
  for (const rule of albIngress) {
    assert.deepEqual(
      rule.SourcePrefixListId,
      { Ref: 'CloudFrontOriginFacingPrefixListId' },
    );
    assert.equal(rule.CidrIp, undefined);
    assert.equal(rule.CidrIpv6, undefined);
    assert.equal(rule.SourceSecurityGroupId, undefined);
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
    'AWS/ApplicationELB',
    'AWS/ECS',
    'ECS/ContainerInsights',
    'AWS/RDS',
    'AWS/ES',
    'AWS/SQS',
    'AWS/Lambda',
    'AWS/DMS',
    'Target error rate (%)',
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
