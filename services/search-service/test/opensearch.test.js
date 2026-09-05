'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  assembleSearchResults,
  requestedDates,
  parseAmenities,
  imageUrl,
} = require('../src/opensearch');
const { MYSQL_SEARCH_SQL, validIsoDate } = require('../src/routes/search');

const data = {
  hotels: [{ hotel_id: 1, name: 'Grand Hotel', location: 'Paris', description: 'Central', stars: 4 }],
  roomTypes: [{
    hotel_id: 1,
    room_type_id: 10,
    name: 'Double',
    max_occupancy: 2,
    amenities: '["WiFi","Safe"]',
  }],
  rates: [
    { hotel_id: 1, room_type_id: 10, date: '2030-04-10', nightly_rate: 140 },
    { hotel_id: 1, room_type_id: 10, date: '2030-04-11', nightly_rate: 150 },
  ],
  inventories: [
    { hotel_id: 1, room_type_id: 10, date: '2030-04-10', total_inventory: 3, total_reserved: 1 },
    { hotel_id: 1, room_type_id: 10, date: '2030-04-11', total_inventory: 3, total_reserved: 2 },
  ],
  images: [{ hotel_id: 1, image_url: 'grand.png', is_primary: 1 }],
};

test('requestedDates uses checkout as an exclusive boundary', () => {
  assert.deepEqual(requestedDates('2030-04-10', '2030-04-12'), ['2030-04-10', '2030-04-11']);
});

test('assembles DMS per-table indices into available room results', () => {
  const results = assembleSearchResults(data, {
    checkIn: '2030-04-10',
    checkOut: '2030-04-12',
    minPrice: 100,
    maxPrice: 200,
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].available_rooms_count, 1);
  assert.equal(results[0].nightly_rate, 140);
  assert.deepEqual(results[0].amenities, ['WiFi', 'Safe']);
  assert.equal(results[0].primary_image_url, '/images/grand.png');
});

test('rejects a room when any requested night is unavailable', () => {
  const unavailable = structuredClone(data);
  unavailable.inventories[1].total_reserved = 3;
  const results = assembleSearchResults(unavailable, {
    checkIn: '2030-04-10', checkOut: '2030-04-12', minPrice: null, maxPrice: null,
  });
  assert.deepEqual(results, []);
});

test('MySQL fallback compares guest count to occupancy and joins rate by date', () => {
  assert.match(MYSQL_SEARCH_SQL, /rt\.max_occupancy >= \?/);
  assert.match(MYSQL_SEARCH_SQL, /rtr\.date = rti\.date/);
  assert.match(MYSQL_SEARCH_SQL, /available_rooms_count > 0/);
});

test('helpers validate calendar dates and normalize values', () => {
  assert.equal(validIsoDate('2030-02-29'), false);
  assert.equal(validIsoDate('2032-02-29'), true);
  assert.deepEqual(parseAmenities('Pool, WiFi'), ['Pool', 'WiFi']);
  assert.equal(imageUrl('https://cdn.example/hotel.png'), 'https://cdn.example/hotel.png');
});
