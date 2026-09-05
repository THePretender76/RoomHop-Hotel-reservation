'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildEmail, parseSqsRecord, processRecord } = require('../index');

test('builds a submission confirmation for the corporate email', () => {
  const email = buildEmail('PartnerApplicationSubmitted', {
    applicantId: 42,
    applicantName: 'Ada Lovelace',
    companyName: 'Analytical Hotels',
    corporateEmail: 'ADA@EXAMPLE.COM',
  });

  assert.equal(email.to, 'ada@example.com');
  assert.match(email.subject, /received/i);
  assert.match(email.text, /42/);
  assert.match(email.text, /Analytical Hotels/);
});

test('builds approved and rejected review messages', () => {
  const base = {
    applicantName: 'Ada',
    companyName: 'Analytical Hotels',
    corporateEmail: 'ada@example.com',
  };
  assert.match(buildEmail('PartnerApplicationReviewed', { ...base, status: 'APPROVED' }).subject, /approved/i);
  assert.match(buildEmail('PartnerApplicationReviewed', { ...base, status: 'REJECTED' }).text, /not approved/i);
});

test('parses the EventBridge envelope delivered through SQS', () => {
  const parsed = parseSqsRecord({ body: JSON.stringify({
    'detail-type': 'PartnerApplicationSubmitted',
    detail: { applicantId: 7 },
  }) });
  assert.equal(parsed.detailType, 'PartnerApplicationSubmitted');
  assert.equal(parsed.detail.applicantId, 7);
});

test('sends one SES command for a valid record', async () => {
  process.env.SENDER_EMAIL = 'verified-sender@example.com';
  const commands = [];
  const client = { send: async (command) => commands.push(command) };
  await processRecord({
    messageId: 'message-1',
    body: JSON.stringify({
      'detail-type': 'PartnerApplicationSubmitted',
      detail: {
        applicantId: 1,
        applicantName: 'Ada',
        companyName: 'Hotels',
        corporateEmail: 'ada@example.com',
      },
    }),
  }, client);
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0].input.Destination.ToAddresses, ['ada@example.com']);
});

test('rejects events without a deliverable recipient', () => {
  assert.throws(
    () => buildEmail('PartnerApplicationSubmitted', { corporateEmail: '' }),
    /valid recipient/i
  );
});
