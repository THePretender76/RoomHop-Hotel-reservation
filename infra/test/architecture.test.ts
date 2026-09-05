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
  return { network, database, search, events, compute };
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
