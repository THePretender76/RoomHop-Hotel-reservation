'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePartnerApplication,
  normalizeCompleteProperty,
} = require('../src/services/adminService');
const {
  createAuthenticator,
  groupsFrom,
} = require('../src/middleware/auth');
const { assertPutEventsSucceeded } = require('../src/eventPublisher');

function validApplication() {
  return {
    companyName: ' RoomHop Hotels ',
    taxId: 'FR-123',
    fullName: 'Ada Lovelace',
    corporateEmail: 'ADA@EXAMPLE.COM',
    phoneNumber: '+33 1 23 45 67 89',
    headOfficeAddress: '1 Hotel Street, Paris',
    estimatedProperties: '3',
    primaryCity: 'Paris',
    websiteUrl: 'https://example.com',
    cognitoSub: 'untrusted-body-value',
  };
}

test('partner payload uses the authenticated identity instead of a body subject', () => {
  const result = normalizePartnerApplication(validApplication(), {
    sub: 'trusted-sub',
    username: 'trusted-username',
  });
  assert.equal(result.cognitoSub, 'trusted-sub');
  assert.equal(result.cognitoUsername, 'trusted-username');
  assert.equal(result.corporateEmail, 'ada@example.com');
  assert.equal(result.estimatedProperties, 3);
});

test('partner payload rejects malformed email, URL, and property count', () => {
  assert.throws(() => normalizePartnerApplication(
    { ...validApplication(), corporateEmail: 'invalid' },
    { sub: 's', username: 'u' }
  ), /email is invalid/i);
  assert.throws(() => normalizePartnerApplication(
    { ...validApplication(), websiteUrl: 'javascript:alert(1)' },
    { sub: 's', username: 'u' }
  ), /http or https/i);
  assert.throws(() => normalizePartnerApplication(
    { ...validApplication(), estimatedProperties: 0 },
    { sub: 's', username: 'u' }
  ), /between 1 and 10000/i);
});

test('complete property validation normalizes numbers and room metadata', () => {
  const result = normalizeCompleteProperty({
    hotel: { name: 'H', location: 'Paris', description: 'D', stars: '4', imageKey: 'properties/user-id/image-id.jpg' },
    roomTypes: [{
      name: 'Suite',
      maxOccupancy: '3',
      nightlyRate: '250.50',
      inventoryCount: '2',
      amenities: [' WiFi ', ''],
      inventoryRoomNumbers: ['101', '101', '102'],
    }],
  });
  assert.equal(result.hotel.stars, 4);
  assert.equal(result.hotel.imageKey, 'properties/user-id/image-id.jpg');
  assert.equal(result.roomTypes[0].nightlyRate, 250.5);
  assert.deepEqual(result.roomTypes[0].amenities, ['WiFi']);
  assert.deepEqual(result.roomTypes[0].roomNumbers, ['101', '102']);
});

test('complete property validation rejects an image key outside the managed prefix', () => {
  assert.throws(() => normalizeCompleteProperty({
    hotel: { name: 'H', location: 'Paris', description: 'D', stars: 4, imageKey: '../private.jpg' },
    roomTypes: [{ name: 'Room', maxOccupancy: 2, nightlyRate: 100, inventoryCount: 1 }],
  }), /image key is invalid/i);
});

test('JWT helpers trust only claims returned by the cryptographic verifier', async () => {
  const payload = { sub: 'abc', 'cognito:groups': ['HotelPartner', 'Guest'] };
  const verifier = { verify: async (token) => {
    assert.equal(token, 'signed-token');
    return payload;
  } };
  const authenticate = createAuthenticator(() => verifier);
  const req = { get: () => 'Bearer signed-token' };
  let continued = false;

  await authenticate(req, {}, () => { continued = true; });

  assert.equal(continued, true);
  assert.equal(req.user.sub, 'abc');
  assert.deepEqual(groupsFrom({ groups: 'HotelPartner, Guest' }), ['HotelPartner', 'Guest']);
});

test('JWT authentication rejects a token rejected by the cryptographic verifier', async () => {
  const authenticate = createAuthenticator(() => ({
    verify: async () => { throw new Error('Invalid signature'); },
  }));
  let statusCode;
  let responseBody;

  await authenticate(
    { get: () => 'Bearer forged-token' },
    {
      status: (status) => {
        statusCode = status;
        return { json: (body) => { responseBody = body; } };
      },
    },
    () => assert.fail('authentication unexpectedly continued')
  );

  assert.equal(statusCode, 401);
  assert.deepEqual(responseBody, { error: 'Invalid authentication token' });
});

test('EventBridge partial failures are treated as failures', () => {
  assert.throws(() => assertPutEventsSucceeded({
    FailedEntryCount: 1,
    Entries: [{ ErrorCode: 'InternalFailure', ErrorMessage: 'retry' }],
  }, 'PartnerApplicationSubmitted'), /InternalFailure/);
  assert.doesNotThrow(() => assertPutEventsSucceeded({
    FailedEntryCount: 0,
    Entries: [{ EventId: 'event-1' }],
  }, 'PartnerApplicationSubmitted'));
});
