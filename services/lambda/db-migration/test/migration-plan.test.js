'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { migrationPlanFor, tableExists } = require('../index');

test('CREATE bootstraps the base schema and applies incremental migrations', () => {
  assert.deepEqual(migrationPlanFor({ RequestType: 'Create' }), {
    bootstrapBaseSchema: true,
    applyPartnerMigration: true,
  });
});

test('UPDATE preserves existing data and only applies incremental migrations', () => {
  assert.deepEqual(migrationPlanFor({ RequestType: 'Update' }), {
    bootstrapBaseSchema: false,
    applyPartnerMigration: true,
  });
});

test('DELETE performs no database migration', () => {
  assert.deepEqual(migrationPlanFor({ RequestType: 'Delete' }), {
    bootstrapBaseSchema: false,
    applyPartnerMigration: false,
  });
});

test('tableExists detects whether an update targets an initialized database', async () => {
  const present = { query: async () => [[{ found: 1 }]] };
  const absent = { query: async () => [[]] };
  assert.equal(await tableExists(present, 'hotel'), true);
  assert.equal(await tableExists(absent, 'hotel'), false);
});
