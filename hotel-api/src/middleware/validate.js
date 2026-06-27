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

/**
 * Validates search query parameters.
 * Returns an array of missing required param names.
 *
 * Required params: location, checkIn, checkOut, guests
 *
 * @param {Object} query - The query parameters to validate
 * @returns {string[]} Array of missing param names
 */
function validateSearchParams(query) {
  const required = ['location', 'checkIn', 'checkOut', 'guests'];

  return required.filter((param) => !query || !query[param]);
}

module.exports = { validateReservationBody, validateSearchParams };
