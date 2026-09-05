'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { analyticsObjectFor, processRecord } = require('../index');

const record = {
  messageId: 'message-123',
  body: JSON.stringify({
    'detail-type': 'BookingConfirmed',
    time: '2030-05-06T12:00:00.000Z',
    detail: {
      reservationId: 7,
      guestEmail: 'guest@example.com',
      hotelName: 'Grand Hotel',
      totalAmount: 240,
    },
  }),
};

test('uses a deterministic partitioned object key', () => {
  const object = analyticsObjectFor(record);
  assert.equal(
    object.key,
    'reservations/year=2030/month=05/day=06/BookingConfirmed_message-123.json'
  );
  assert.equal(object.body.hotelName, 'Grand Hotel');
});

test('processRecord writes the normalized event to S3', async () => {
  process.env.ANALYTICS_BUCKET = 'analytics-bucket';
  let command;
  const client = { send: async (value) => { command = value; } };
  const key = await processRecord(record, client);
  assert.equal(key.includes('message-123'), true);
  assert.equal(command.input.Bucket, 'analytics-bucket');
  assert.equal(JSON.parse(command.input.Body).reservationId, 7);
});
