'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../src/app');

test('search handles browser preflights without API Gateway', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const response = await fetch(`http://127.0.0.1:${server.address().port}/v1/search?location=Paris`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'https://roomhop.example',
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,x-request-id',
    },
  });
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.match(response.headers.get('access-control-allow-methods'), /GET/);
  assert.equal(response.headers.get('access-control-allow-headers'), 'authorization,x-request-id');
  assert.equal(response.headers.get('access-control-max-age'), '3600');
});
