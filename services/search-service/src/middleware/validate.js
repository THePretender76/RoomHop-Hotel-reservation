'use strict';

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

module.exports = { validateSearchParams };
