'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateKeyPairSync, sign } = require('node:crypto');
const { CognitoJwtVerifier } = require('aws-jwt-verify');
const { createAuthenticator, requireGroup } = require('../src/middleware/auth');

const userPoolId = 'us-east-1_testpool';
const clientId = 'roomhop-test-client';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const verifier = CognitoJwtVerifier.create({ userPoolId, clientId, tokenUse: 'id' });
verifier.cacheJwks({ keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' }] });
const authenticate = createAuthenticator(() => verifier);

function token(overrides = {}, signingKey = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode({ alg: 'RS256', kid: 'test-key' })}.${encode({
    iss: `https://cognito-idp.us-east-1.amazonaws.com/${userPoolId}`,
    aud: clientId, token_use: 'id', sub: 'guest-123', email: 'guest@example.com',
    iat: now, exp: now + 300, 'cognito:groups': ['Guest'], ...overrides,
  })}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), signingKey).toString('base64url')}`;
}

async function request(authorization) {
  const req = { get: (header) => header === 'authorization' ? authorization : undefined };
  const result = { next: false };
  const res = {
    status(status) { result.status = status; return this; },
    json(body) { result.body = body; return this; },
  };
  await authenticate(req, res, () => { result.next = true; });
  return { req, res, result };
}

test('verifies a signed Cognito ID bearer token inside ECS without gateway identity headers', async () => {
  const { req, res, result } = await request(`Bearer ${token()}`);
  assert.equal(result.next, true);
  assert.equal(req.user.sub, 'guest-123');
  assert.equal(req.user.email, 'guest@example.com');
  requireGroup('SuperAdmin')(req, res, () => assert.fail('Guest must not become SuperAdmin'));
  assert.equal(result.status, 403);
});

test('rejects missing, malformed, expired, wrong issuer/client/type and forged tokens', async () => {
  const attacker = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  for (const authorization of [
    undefined, 'Bearer broken', 'Basic credentials',
    `Bearer ${token({ exp: 1 })}`,
    `Bearer ${token({ iss: 'https://untrusted.example/pool' })}`,
    `Bearer ${token({ aud: 'another-client' })}`,
    `Bearer ${token({ token_use: 'access', client_id: clientId })}`,
    `Bearer ${token({}, attacker)}`,
  ]) {
    const { req, result } = await request(authorization);
    assert.equal(result.status, 401);
    assert.equal(result.next, false);
    assert.equal(req.user, undefined);
  }
});
