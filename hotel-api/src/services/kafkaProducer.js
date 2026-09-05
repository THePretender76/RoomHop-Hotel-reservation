'use strict';

const { Kafka } = require('kafkajs');
const logger = require('../logger');

const broker = process.env.KAFKA_BROKER || 'localhost:9022';

const kafka = new Kafka({
  clientId: 'hotel-api',
  brokers: [broker],
});

const producer = kafka.producer();

/**
 * Initialise and connect the Kafka producer.
 * If the connection fails, logs the error and resolves without throwing —
 * the app can start without Kafka being available.
 */
async function initProducer() {
  try {
    await producer.connect();
    logger.info('Connected to Kafka broker', { broker });
  } catch (err) {
    logger.error('Failed to connect to Kafka', { broker, error: err.message, stack: err.stack });
  }
}

/**
 * Publish an event to the specified Kafka topic.
 * Fire-and-forget: on failure, logs a structured JSON error but does not throw.
 *
 * @param {string} topic  - Kafka topic name
 * @param {object} event  - Event payload (will be JSON-serialised)
 */
async function publish(topic, event) {
  try {
    await producer.send({
      topic,
      messages: [{ value: JSON.stringify(event) }],
    });
    logger.debug('Event published to Kafka', { topic, eventType: event.eventType });
  } catch (err) {
    logger.error('Kafka publish failed', { topic, error: err.message, stack: err.stack });
  }
}

/**
 * Publish an event and propagate failures to the caller. Use this when the
 * HTTP response promises that a downstream notification has been queued.
 */
async function publishOrThrow(topic, event) {
  await producer.send({
    topic,
    messages: [{ value: JSON.stringify(event) }],
  });
  logger.debug('Event published to Kafka', { topic, eventType: event.eventType });
}

module.exports = { initProducer, publish, publishOrThrow };
