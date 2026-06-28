'use strict';

// =====================================================================
// ANALYTICS SERVICE — Kafka Consumer Entry Point
//
// Consumes business events from the hotel.events.reservations topic,
// transforms them into analytical models, and writes Parquet files
// to the MinIO data lake for Trino/Metabase consumption.
//
// This service NEVER exposes HTTP endpoints.
// Its sole responsibility is analytics ingestion.
// =====================================================================

const { Kafka } = require('kafkajs');
const config = require('./config');
const logger = require('./logger');
const { ensureBucket } = require('./storage/minioClient');
const { routeEvent, startFlushTimer, stopFlushTimer } = require('./transformers/eventRouter');

const kafka = new Kafka({
  clientId: config.service.name,
  brokers: [config.kafka.broker],
});

const consumer = kafka.consumer({ groupId: config.kafka.groupId });

async function run() {
  // Ensure analytics bucket exists in MinIO
  await ensureBucket();

  // Connect to Kafka
  await consumer.connect();
  await consumer.subscribe({ topic: config.kafka.topic, fromBeginning: false });
  logger.info('Analytics consumer connected', {
    topic: config.kafka.topic,
    groupId: config.kafka.groupId,
    broker: config.kafka.broker,
  });

  // Start the periodic flush timer (writes buffered events every 30s)
  startFlushTimer();

  // Process messages
  await consumer.run({
    eachMessage: async ({ message }) => {
      let event;
      try {
        event = JSON.parse(message.value.toString());
      } catch (err) {
        logger.error('Failed to parse analytics event', { error: err.message });
        return;
      }

      try {
        await routeEvent(event);
      } catch (err) {
        logger.error('Failed to route analytics event', { error: err.message, eventType: event.eventType });
      }
    },
  });
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down analytics service...');
  await stopFlushTimer();
  await consumer.disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Shutting down analytics service...');
  await stopFlushTimer();
  await consumer.disconnect();
  process.exit(0);
});

// Start
run().catch((err) => {
  logger.error('Analytics service fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
