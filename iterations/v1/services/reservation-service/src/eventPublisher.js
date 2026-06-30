'use strict';

const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const logger = require('./logger');

const client = new EventBridgeClient({ region: process.env.AWS_REGION || 'eu-west-1' });
const EVENT_BUS = process.env.EVENT_BUS_NAME || 'roomhop-events';

async function publishEvent(detailType, detail) {
  try {
    await client.send(new PutEventsCommand({
      Entries: [{
        Source: 'roomhop.reservation',
        DetailType: detailType,
        Detail: JSON.stringify(detail),
        EventBusName: EVENT_BUS,
      }],
    }));
    logger.info('Event published', { detailType, reservationId: detail.reservationId });
  } catch (err) {
    logger.error('Failed to publish event', { error: err.message, detailType });
    // Fire-and-forget — don't throw
  }
}

module.exports = { publishEvent };
