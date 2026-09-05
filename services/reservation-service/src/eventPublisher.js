'use strict';

const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const logger = require('./logger');

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

async function publishEvent(detailType, detail, source = 'roomhop.reservation') {
  try {
    const response = await client.send(new PutEventsCommand({
      Entries: [{
        Source: source,
        DetailType: detailType,
        Detail: JSON.stringify(detail),
        EventBusName: EVENT_BUS,
      }],
    }));

    assertPutEventsSucceeded(response, detailType);
    logger.info('Event published', {
      detailType,
      source,
      entityId: detail.reservationId || detail.applicantId,
    });
    return response;
  } catch (error) {
    logger.error('Failed to publish event', {
      error: error.message,
      detailType,
      source,
    });
    throw error;
  }
}

module.exports = { publishEvent, assertPutEventsSucceeded };
