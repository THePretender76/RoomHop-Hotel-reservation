'use strict';

/**
 * Validates a reservation request body.
 * Returns an array of missing required field names.
 *
 * Required fields: hotel_id, room_type_id, guest_id, start_date, end_date, room_count
 *
 * @param {Object} body - The request body to validate
 * @returns {string[]} Array of missing field names
 */
function validateReservationBody(body) {
  const required = [
    'hotel_id',
    'room_type_id',
    'guest_id',
    'start_date',
    'end_date',
    'room_count',
  ];

  return required.filter((field) => !body || !body[field]);
}

module.exports = { validateReservationBody };
