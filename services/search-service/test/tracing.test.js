'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { InMemorySpanExporter, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace-base');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { app } = require('../src/app');
const { handleSearch } = require('../src/routes/search');
const {
  defaultSamplingRate,
  safeAnnotations,
  withSpan,
} = require('../src/tracing');

const execFileAsync = promisify(execFile);
const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});
provider.register();

test.after(async () => provider.shutdown());

function responseRecorder() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('sampling defaults are explicit per environment', () => {
  assert.equal(defaultSamplingRate('development'), 1);
  assert.equal(defaultSamplingRate('test'), 1);
  assert.equal(defaultSamplingRate('staging'), 0.5);
  assert.equal(defaultSamplingRate('production'), 0.1);
  assert.equal(defaultSamplingRate('unknown'), 0.1);
});

test('trace annotations drop PII, credentials, tokens, SQL, and arbitrary fields', () => {
  assert.deepEqual(safeAnnotations({
    service: 'search',
    fallback: true,
    operation: 'hotel_search',
    email: 'guest@example.com',
    jwt: 'header.payload.signature',
    token: 'secret-token',
    password: 'secret',
    sql: 'SELECT * FROM guest',
    full_name: 'Guest Name',
  }), {
    service: 'search',
    fallback: true,
    operation: 'hotel_search',
  });
});

test('OpenSearch failure keeps the response contract and creates MySQL fallback spans', async () => {
  exporter.reset();
  const req = {
    query: {
      location: 'Paris',
      checkIn: '2030-04-10',
      checkOut: '2030-04-12',
      guests: '2',
    },
  };
  const res = responseRecorder();

  await withSpan('search.request', async () => handleSearch(req, res, {
    openSearchConfigured: () => true,
    searchHotels: async () => {
      const error = new Error('unavailable');
      error.name = 'OpenSearchUnavailable';
      throw error;
    },
    searchMySql: async () => [{ hotel_id: 1 }],
  }));

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { results: [{ hotel_id: 1 }], source: 'mysql' });
  const spans = exporter.getFinishedSpans();
  const root = spans.find((span) => span.name === 'search.request');
  const openSearch = spans.find((span) => span.name === 'opensearch.search');
  const fallback = spans.find((span) => span.name === 'mysql.fallback');
  assert.ok(root && openSearch && fallback);
  assert.equal(openSearch.parentSpanContext.spanId, root.spanContext().spanId);
  assert.equal(fallback.parentSpanContext.spanId, root.spanContext().spanId);
  assert.equal(openSearch.attributes.error_type, 'opensearch_error');
  assert.equal(root.attributes.fallback, true);
  assert.equal(root.attributes.result_source, 'mysql');
});

test('HTTP instrumentation does not change validation responses', async (t) => {
  const server = app.listen(0);
  t.after(() => server.close());
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/v1/search`);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: 'Missing required query parameters: location, checkIn, checkOut, guests',
  });
});

test('collector unavailability is fail-open and does not crash the process', async () => {
  const script = [
    "const tracing = require('./src/tracing');",
    'tracing.startTracing();',
    "tracing.withSpan('availability.test', () => undefined);",
    'tracing.shutdownTracing().then(() => process.exit(0));',
  ].join('');
  const { stderr } = await execFileAsync(process.execPath, ['-e', script], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      TRACING_ENABLED: 'true',
      OTEL_TRACES_SAMPLER_ARG: '1',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1:1/v1/traces',
    },
    timeout: 10000,
  });
  assert.equal(stderr, '');
});
