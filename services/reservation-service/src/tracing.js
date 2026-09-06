'use strict';

const {
  context,
  isSpanContextValid,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  TraceFlags,
  trace,
} = require('@opentelemetry/api');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { AWSXRayIdGenerator } = require('@opentelemetry/id-generator-aws-xray');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} = require('@opentelemetry/sdk-trace-base');
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || process.env.SERVICE_NAME || 'reservation-service';
const SERVICE_ANNOTATION = SERVICE_NAME.replace(/^roomhop-/, '').replace(/-service$/, '');
const SAFE_ANNOTATION_KEYS = new Set([
  'auth_valid',
  'error_type',
  'event_type',
  'fallback',
  'operation',
  'result_source',
  'service',
]);
const annotationKeysBySpan = new WeakMap();

let provider;
let initialized = false;

function defaultSamplingRate(environment = process.env.DEPLOYMENT_ENVIRONMENT
  || process.env.NODE_ENV
  || 'development') {
  const rates = {
    development: 1,
    dev: 1,
    test: 1,
    staging: 0.5,
    recette: 0.5,
    production: 0.1,
    prod: 0.1,
  };
  return rates[String(environment).toLowerCase()] ?? 0.1;
}

function samplingRate() {
  const configured = Number(process.env.OTEL_TRACES_SAMPLER_ARG);
  return Number.isFinite(configured) && configured >= 0 && configured <= 1
    ? configured
    : defaultSamplingRate();
}

function tracingEnabled() {
  return String(process.env.TRACING_ENABLED || '').toLowerCase() === 'true';
}

function startTracing() {
  if (initialized || !tracingEnabled()) return provider;
  initialized = true;

  try {
    const exporter = new OTLPTraceExporter({
      url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
        || 'http://127.0.0.1:4318/v1/traces',
      timeoutMillis: 2000,
    });
    provider = new NodeTracerProvider({
      resource: resourceFromAttributes({
        'service.name': SERVICE_NAME,
        'deployment.environment.name': process.env.DEPLOYMENT_ENVIRONMENT
          || process.env.NODE_ENV
          || 'development',
      }),
      sampler: new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(samplingRate()),
      }),
      idGenerator: new AWSXRayIdGenerator(),
      spanLimits: {
        attributeCountLimit: 24,
        attributeValueLengthLimit: 256,
        eventCountLimit: 0,
      },
      spanProcessors: [new BatchSpanProcessor(exporter, {
        maxQueueSize: 512,
        maxExportBatchSize: 128,
        scheduledDelayMillis: 5000,
        exportTimeoutMillis: 2000,
      })],
    });
    provider.register();
  } catch (error) {
    // Tracing is deliberately fail-open: telemetry must never stop the service.
    initialized = false;
    console.error('OpenTelemetry initialization failed', { errorType: error?.name || 'Error' });
  }

  return provider;
}

async function shutdownTracing() {
  if (!provider) return;
  const currentProvider = provider;
  provider = undefined;
  initialized = false;
  try {
    await currentProvider.shutdown();
  } catch {
    // Export failures during shutdown are non-fatal by design.
  }
}

function safeAnnotations(attributes = {}) {
  return Object.fromEntries(Object.entries(attributes).filter(([key, value]) => (
    SAFE_ANNOTATION_KEYS.has(key)
    && ['string', 'number', 'boolean'].includes(typeof value)
  )));
}

function annotate(span, attributes) {
  if (!span) return;
  const safe = safeAnnotations(attributes);
  const keys = new Set(annotationKeysBySpan.get(span) || []);
  for (const [key, value] of Object.entries(safe)) {
    span.setAttribute(key, value);
    keys.add(key);
  }
  const annotationKeys = [...keys].sort();
  annotationKeysBySpan.set(span, annotationKeys);
  span.setAttribute('aws.xray.annotations', annotationKeys);
}

function markSpanError(span, errorType = 'application_error') {
  if (!span) return;
  const normalized = String(errorType).replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 64)
    || 'application_error';
  annotate(span, { error_type: normalized });
  span.setStatus({ code: SpanStatusCode.ERROR, message: normalized });
}

function activeSpan() {
  return trace.getSpan(context.active());
}

function annotateActive(attributes) {
  annotate(activeSpan(), attributes);
}

function markActiveSpanError(errorType) {
  markSpanError(activeSpan(), errorType);
}

function withSpan(name, options, fn) {
  const config = typeof options === 'function' ? {} : options || {};
  const operation = typeof options === 'function' ? options : fn;
  const tracer = trace.getTracer(SERVICE_NAME);

  return tracer.startActiveSpan(name, {
    kind: config.kind || SpanKind.INTERNAL,
  }, (span) => {
    annotate(span, config.annotations);
    try {
      const result = operation(span);
      if (result && typeof result.then === 'function') {
        return result.then((value) => {
          if (config.autoStatus !== false) span.setStatus({ code: SpanStatusCode.OK });
          return value;
        }).catch((error) => {
          const errorType = typeof config.errorType === 'function'
            ? config.errorType(error)
            : config.errorType;
          markSpanError(span, errorType || 'application_error');
          throw error;
        }).finally(() => span.end());
      }
      if (config.autoStatus !== false) span.setStatus({ code: SpanStatusCode.OK });
      span.end();
      return result;
    } catch (error) {
      const errorType = typeof config.errorType === 'function'
        ? config.errorType(error)
        : config.errorType;
      markSpanError(span, errorType || 'application_error');
      span.end();
      throw error;
    }
  });
}

function tracingMiddleware(resolveOperation) {
  return (req, res, next) => {
    if (req.path === '/health') return next();

    const operation = resolveOperation(req);
    const tracer = trace.getTracer(SERVICE_NAME);
    // The public HTTP API cannot emit or safely establish an X-Ray parent.
    // Start a trusted local root instead of honoring caller-controlled headers.
    const span = tracer.startSpan(operation, { kind: SpanKind.SERVER }, ROOT_CONTEXT);
    annotate(span, {
      service: SERVICE_ANNOTATION,
      operation,
    });
    const requestContext = trace.setSpan(ROOT_CONTEXT, span);
    let ended = false;

    const endSpan = () => {
      if (ended) return;
      ended = true;
      span.setAttribute('http.response.status_code', res.statusCode);
      if (res.statusCode >= 500) markSpanError(span, 'server_error');
      else if (res.statusCode >= 400) markSpanError(span, 'business_error');
      span.end();
    };
    res.once('finish', endSpan);
    res.once('close', endSpan);
    context.with(requestContext, next);
  };
}

function currentTraceContext() {
  const spanContext = activeSpan()?.spanContext();
  if (!spanContext || !isSpanContextValid(spanContext)) return {};
  return {
    traceId: `1-${spanContext.traceId.slice(0, 8)}-${spanContext.traceId.slice(8)}`,
    spanId: spanContext.spanId,
  };
}

function currentXRayTraceHeader() {
  const spanContext = activeSpan()?.spanContext();
  if (!spanContext || !isSpanContextValid(spanContext)) return undefined;
  const root = `1-${spanContext.traceId.slice(0, 8)}-${spanContext.traceId.slice(8)}`;
  const sampled = (spanContext.traceFlags & TraceFlags.SAMPLED) === TraceFlags.SAMPLED ? '1' : '0';
  return `Root=${root};Parent=${spanContext.spanId};Sampled=${sampled}`;
}

module.exports = {
  SAFE_ANNOTATION_KEYS,
  activeSpan,
  annotate,
  annotateActive,
  currentTraceContext,
  currentXRayTraceHeader,
  defaultSamplingRate,
  markActiveSpanError,
  markSpanError,
  safeAnnotations,
  samplingRate,
  shutdownTracing,
  startTracing,
  tracingMiddleware,
  withSpan,
};
