'use strict';

const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const { SpanKind } = require('@opentelemetry/api');
const logger = require('./logger');
const { currentXRayTraceHeader, withSpan } = require('./tracing');

const client = new EventBridgeClient({ region: process.env.AWS_REGION || 'us-east-1' });
const EVENT_BUS = process.env.EVENT_BUS_NAME || 'roomhop-events';

function assertPutEventsSucceeded(response, detailType) {
  const failedEntries = (response?.Entries || []).filter((entry) => entry.ErrorCode);
  if ((response?.FailedEntryCount || 0) > 0 || failedEntries.length > 0) {
    const failure = failedEntries[0] || {};
    const error = new Error(
      `EventBridge rejected ${detailType}: ${failure.ErrorCode || 'unknown error'}${failure.ErrorMessage ? ` - ${failure.ErrorMessage}` : ''}`
    );
    error.code = failure.ErrorCode || 'EventBridgePutEventsFailed';
    throw error;
  }
}

async function publishEvent(
  detailType,
  detail,
  source = 'roomhop.reservation',
  eventBridgeClient = client
) {
  return withSpan('eventbridge.putEvents', {
    kind: SpanKind.CLIENT,
    annotations: { event_type: detailType, operation: 'event_publish' },
    errorType: 'eventbridge_error',
  }, async (span) => {
    try {
      span.setAttribute('rpc.system', 'aws-api');
      span.setAttribute('rpc.service', 'EventBridge');
      span.setAttribute('rpc.method', 'PutEvents');
      span.setAttribute('aws.region', process.env.AWS_REGION || 'us-east-1');
      const traceHeader = currentXRayTraceHeader();
      const response = await eventBridgeClient.send(new PutEventsCommand({
        Entries: [{
          Source: source,
          DetailType: detailType,
          Detail: JSON.stringify(detail),
          EventBusName: EVENT_BUS,
          ...(traceHeader ? { TraceHeader: traceHeader } : {}),
        }],
      }));

      assertPutEventsSucceeded(response, detailType);
      logger.info('Event published', { detailType, source });
      return response;
    } catch (error) {
      logger.error('Failed to publish event', {
        errorType: error?.name || error?.code || 'EventBridgeError',
        detailType,
        source,
      });
      throw error;
    }
  });
}

module.exports = { publishEvent, assertPutEventsSucceeded };
