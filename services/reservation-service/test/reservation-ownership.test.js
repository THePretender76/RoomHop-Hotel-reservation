'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const reservationsRouter = require('../src/routes/reservations');
const {
  createReservation,
  cancelReservation,
} = require('../src/services/reservationService');

test('requiredIdentity rejects anonymous access and normalizes the Cognito email', () => {
  assert.throws(
    () => reservationsRouter.requiredIdentity({}),
    (error) => error.status === 401
  );
  assert.deepEqual(
    reservationsRouter.requiredIdentity({ sub: 'user-1', email: ' USER@EXAMPLE.COM ' }),
    { sub: 'user-1', email: 'user@example.com' }
  );
});

test('idempotency lookup is scoped to the authenticated guest record', async (t) => {
  const originalQuery = db.query;
  t.after(() => { db.query = originalQuery; });

  let captured;
  db.query = async (sql, parameters) => {
    captured = { sql, parameters };
    return [[{ reservation_id: 55, guest_id: 8 }]];
  };

  const result = await createReservation({ guest_id: 8 }, 'request-key');
  assert.equal(result.existing, true);
  assert.match(captured.sql, /guest_id = \?/);
  assert.deepEqual(captured.parameters, ['request-key', 8]);
});

test('cancellation locks and filters the reservation by Cognito subject', async (t) => {
  const originalGetConnection = db.getConnection;
  t.after(() => { db.getConnection = originalGetConnection; });

  const calls = [];
  const reservation = {
    reservation_id: 55,
    guest_id: 8,
    hotel_id: 2,
    room_type_id: 4,
    room_count: 1,
    start_date: '2026-09-10',
    end_date: '2026-09-12',
    status: 'CONFIRMED',
    created_at: new Date(),
    guest_email: 'user@example.com',
  };
  const connection = {
    beginTransaction: async () => {},
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      return calls.length === 1 ? [[reservation]] : [{ affectedRows: 1 }];
    },
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  };
  db.getConnection = async () => connection;

  const result = await cancelReservation(55, 'cognito-user-1');
  assert.equal(result.status, 'CANCELLED');
  assert.match(calls[0].sql, /g\.cognito_sub = \?/);
  assert.match(calls[0].sql, /FOR UPDATE/);
  assert.deepEqual(calls[0].parameters, [55, 'cognito-user-1']);
});
