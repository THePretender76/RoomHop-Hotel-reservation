'use strict';

const { Kafka } = require('kafkajs');

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
    console.log(`[kafkaProducer] Connected to Kafka broker at ${broker}`);
  } catch (err) {
    console.error(
      JSON.stringify({
        message: '[kafkaProducer] Failed to connect to Kafka',
        broker,
        error: err.message,
      })
    );
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
  } catch (err) {
    console.error(
      JSON.stringify({
        error: err.message,
        topic,
        event,
      })
    );
  }
}

module.exports = { initProducer, publish };
