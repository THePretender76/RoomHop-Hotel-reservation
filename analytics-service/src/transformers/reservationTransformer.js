'use strict';

// =====================================================================
// RESERVATION TRANSFORMER
//
// Transforms raw Kafka reservation events into the analytical model
// suitable for Parquet storage and Trino queries.
// =====================================================================

const logger = require('../logger');

/**
 * Transform a raw reservation event into the analytics schema.
 * @param {Object} event - Raw Kafka event payload
 * @returns {Object} Transformed record ready for Parquet writing
 */
function transformReservationEvent(event) {
  const occurredAt = new Date(event.occurredAt || new Date().toISOString());

  return {
    reservation_id: Number(event.reservationId) || 0,
    hotel_id: Number(event.hotelId) || 0,
    guest_id: Number(event.guestId) || 0,
    room_type: event.roomTypeName || null,
    event_type: event.eventType || 'unknown',
    booking_date: occurredAt.toISOString().split('T')[0],
    check_in: event.startDate || null,
    check_out: event.endDate || null,
    room_count: Number(event.roomCount) || null,
    amount: event.amount ? Number(event.amount) : null,
    guest_email: event.guestEmail || null,
    hotel_name: event.hotelName || null,
    occurred_at: occurredAt.toISOString(),
    year: occurredAt.getFullYear(),
    month: occurredAt.getMonth() + 1,
  };
}

module.exports = { transformReservationEvent };
