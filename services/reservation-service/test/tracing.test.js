'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { InMemorySpanExporter, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const db = require('../src/db');
const { app } = require('../src/app');
const { publishEvent } = require('../src/eventPublisher');
const { createAuthenticator } = require('../src/middleware/auth');
const { createReservation } = require('../src/services/reservationService');
const { safeAnnotations, withSpan } = require('../src/tracing');

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
provider.register();

test.after(async () => provider.shutdown());

test('trace annotations expose only the explicit non-sensitive allowlist', () => {
  assert.deepEqual(safeAnnotations({
    auth_valid: true,
    event_type: 'BookingConfirmed',
    operation: 'reservation_create',
    email: 'guest@example.com',
    jwt: 'header.payload.signature',
    cognito_sub: 'private-subject',
    password: 'secret',
    sql: 'SELECT * FROM guest',
  }), {
    auth_valid: true,
    event_type: 'BookingConfirmed',
    operation: 'reservation_create',
  });
});

test('reservation flow creates the intended span hierarchy and keeps the transaction working', async (t) => {
  exporter.reset();
  const originalGetConnection = db.getConnection;
  t.after(() => { db.getConnection = originalGetConnection; });
  let queryIndex = 0;
  let committed = false;
  let rolledBack = false;
  let released = false;
  const responses = [
    [[
      { total_inventory: 3, total_reserved: 1 },
      { total_inventory: 3, total_reserved: 1 },
    ]],
    [[{ nightCount: 2 }]],
    [[{ nightly_rate: 100 }, { nightly_rate: 120 }]],
    [{ insertId: 55 }],
    [{ affectedRows: 2 }],
  ];
  db.getConnection = async () => ({
    beginTransaction: async () => {},
    query: async () => responses[queryIndex++],
    commit: async () => { committed = true; },
    rollback: async () => { rolledBack = true; },
    release: () => { released = true; },
  });

  const verifiedPayload = {
    sub: 'user-1',
    email: 'guest@example.com',
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  const authenticate = createAuthenticator(() => ({
    verify: async (token) => {
      assert.equal(token, 'cryptographically-signed-token');
      return verifiedPayload;
    },
  }));
  const authRequest = { get: () => 'Bearer cryptographically-signed-token' };
  let authenticationContinued = false;
  let eventCommand;
  const eventBridgeClient = {
    send: async (command) => {
      eventCommand = command;
      return { FailedEntryCount: 0, Entries: [{}] };
    },
  };

  const result = await withSpan('reservation.create', async () => {
    await authenticate(
      authRequest,
      { status: () => ({ json: () => assert.fail('authentication unexpectedly failed') }) },
      () => { authenticationContinued = true; }
    );
    const reservation = await createReservation({
      hotel_id: 2,
      room_type_id: 4,
      guest_id: 8,
      start_date: '2030-04-10',
      end_date: '2030-04-12',
      room_count: 1,
    });
    await publishEvent(
      'BookingConfirmed',
      { reservationId: reservation.reservation.reservation_id },
      'roomhop.reservation',
      eventBridgeClient
    );
    return reservation;
  });

  assert.equal(result.reservation.reservation_id, 55);
  assert.equal(committed, true);
  assert.equal(rolledBack, false);
  assert.equal(released, true);
  assert.equal(queryIndex, 5);

  const spans = exporter.getFinishedSpans();
  const byName = new Map(spans.map((span) => [span.name, span]));
  const root = byName.get('reservation.create');
  const transaction = byName.get('mysql.transaction');
  assert.ok(root && transaction);
  for (const name of ['auth.verify', 'mysql.transaction', 'eventbridge.putEvents']) {
    assert.equal(byName.get(name).parentSpanContext.spanId, root.spanContext().spanId);
  }
  for (const name of [
    'mysql.inventoryLock',
    'mysql.createReservation',
    'mysql.updateInventory',
    'mysql.commit',
  ]) {
    assert.equal(byName.get(name).parentSpanContext.spanId, transaction.spanContext().spanId);
  }
  assert.equal(byName.get('auth.verify').attributes.auth_valid, true);
  assert.equal(byName.get('eventbridge.putEvents').attributes.event_type, 'BookingConfirmed');
  assert.equal(byName.get('eventbridge.putEvents').attributes['rpc.service'], 'EventBridge');
  assert.match(eventCommand.input.Entries[0].TraceHeader, /^Root=1-[0-9a-f]{8}-[0-9a-f]{24};Parent=[0-9a-f]{16};Sampled=1$/);
  assert.equal(authenticationContinued, true);
  assert.equal(authRequest.user.sub, 'user-1');
});

test('HTTP instrumentation does not change unauthenticated responses', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/v1/reservations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Authentication required' });
});
