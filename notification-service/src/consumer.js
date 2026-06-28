'use strict';

const { Kafka } = require('kafkajs');
const { handleConfirmed, handleCancelled } = require('./notificationHandler');
const logger = require('./logger');

const BROKER = process.env.KAFKA_BROKER || 'localhost:9022';
const TOPIC = 'hotel.events.reservations';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

const kafka = new Kafka({ clientId: 'notification-service', brokers: [BROKER] });
const consumer = kafka.consumer({ groupId: 'notification-service' });

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function processMessage(event) {
  if (event.eventType === 'reservation.confirmed') {
    await handleConfirmed(event);
  } else if (event.eventType === 'reservation.cancelled') {
    await handleCancelled(event);
  } else {
    logger.warn('Unknown event type received', { eventType: event.eventType });
  }
}

async function processWithRetry(event) {
  let attempts = 0;
  while (attempts < MAX_RETRIES) {
    try {
      await processMessage(event);
      return; // success
    } catch (err) {
      attempts++;
      if (attempts >= MAX_RETRIES) {
        // Permanent failure — log structured error and give up (do NOT make a fourth attempt)
        logger.error('Permanent notification failure', {
          guestId: event.guestId,
          reservationId: event.reservationId,
          error: err.message || String(err),
          attempts: MAX_RETRIES,
        });
        return;
      }
      await sleep(RETRY_DELAY_MS);
    }
  }
}

async function run() {
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

  logger.info('Consumer connected to Kafka', { topic: TOPIC, groupId: 'notification-service', broker: BROKER });

  await consumer.run({
    eachMessage: async ({ message }) => {
      let event;
      try {
        event = JSON.parse(message.value.toString());
      } catch (err) {
        logger.error('Failed to parse message', { error: err.message });
        return;
      }
      await processWithRetry(event);
    },
  });
}

module.exports = { run, processWithRetry, processMessage };

// Start the consumer when this file is run directly
if (require.main === module) {
  run().catch((err) => {
    logger.error('Consumer fatal error', { error: err.message, stack: err.stack });
    process.exit(1);
  });
}
