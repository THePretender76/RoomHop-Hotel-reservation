'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../src/app');

test('protected APIs allow preflight while requiring a JWT on the actual request', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/v1/reservations`;
  const response = await fetch(url, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://roomhop.example',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key,x-request-id',
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.match(response.headers.get('access-control-allow-methods'), /POST/);
  assert.equal(response.headers.get('access-control-allow-headers'), 'authorization,content-type,idempotency-key,x-request-id');
  assert.equal(response.headers.get('access-control-max-age'), '3600');
  for (const path of ['/v1/reservations', '/v1/admin/partners/applications']) {
    const denied = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      headers: { Origin: 'https://roomhop.example', 'x-amzn-oidc-identity': 'forged-user' },
    });
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get('access-control-allow-origin'), '*');
  }
});
