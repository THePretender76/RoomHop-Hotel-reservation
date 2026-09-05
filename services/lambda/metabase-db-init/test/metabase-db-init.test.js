'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { initialiseDatabase } = require('../index');

test('initialiseDatabase creates a dedicated database and closes its connection', async () => {
  const calls = [];
  let closed = false;
  const connection = {
    query: async (...args) => calls.push(args),
    end: async () => { closed = true; },
  };

  await initialiseDatabase(
    { host: 'db', port: 3306, username: 'admin', password: 'secret' },
    { password: 'metabase-secret' },
    async () => connection
  );

  assert.equal(calls.length, 4);
  assert.deepEqual(calls[1][1], ['metabase-secret']);
  assert.equal(closed, true);
});
