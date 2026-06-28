'use strict';

// =====================================================================
// EVENT ROUTER
//
// Routes incoming Kafka events to the appropriate transformer and writer.
// Currently supports reservation events; extensible for payments, users, etc.
// =====================================================================

const { transformReservationEvent } = require('./reservationTransformer');
const { writeReservationBatch } = require('../writers/parquetWriter');
const logger = require('../logger');

// Buffer events and flush periodically (batch writes for efficiency)
const BATCH_SIZE = 10;       // Write after 10 events
const FLUSH_INTERVAL = 30000; // Or every 30 seconds
let reservationBuffer = [];
let flushTimer = null;

/**
 * Route and buffer a single event.
 * @param {Object} event - Parsed Kafka event
 */
async function routeEvent(event) {
  const { eventType } = event;

  if (eventType === 'reservation.confirmed' || eventType === 'reservation.cancelled') {
    const transformed = transformReservationEvent(event);
    reservationBuffer.push(transformed);

    logger.debug('Event buffered', { eventType, reservationId: event.reservationId, bufferSize: reservationBuffer.length });

    // Flush if batch is full
    if (reservationBuffer.length >= BATCH_SIZE) {
      await flushReservations();
    }
  } else {
    logger.warn('Unhandled event type in analytics', { eventType });
  }
}

/**
 * Flush the reservation buffer to Parquet/MinIO.
 */
async function flushReservations() {
  if (reservationBuffer.length === 0) return;

  const batch = [...reservationBuffer];
  reservationBuffer = [];

  try {
    await writeReservationBatch(batch);
  } catch (err) {
    logger.error('Failed to write Parquet batch', { error: err.message, batchSize: batch.length });
    // Put events back in buffer for retry
    reservationBuffer = [...batch, ...reservationBuffer];
  }
}

/**
 * Start the periodic flush timer.
 */
function startFlushTimer() {
  flushTimer = setInterval(async () => {
    await flushReservations();
  }, FLUSH_INTERVAL);
}

/**
 * Stop the flush timer and do a final flush.
 */
async function stopFlushTimer() {
  if (flushTimer) clearInterval(flushTimer);
  await flushReservations();
}

module.exports = { routeEvent, flushReservations, startFlushTimer, stopFlushTimer };
