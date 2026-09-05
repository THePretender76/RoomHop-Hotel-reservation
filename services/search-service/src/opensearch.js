'use strict';

const { Client } = require('@opensearch-project/opensearch');
const { AwsSigv4Signer } = require('@opensearch-project/opensearch/aws');
const { defaultProvider } = require('@aws-sdk/credential-provider-node');

let client;

function getClient() {
  if (!client) {
    client = new Client({
      ...AwsSigv4Signer({
        region: process.env.AWS_REGION || 'us-east-1',
        getCredentials: defaultProvider(),
      }),
      node: process.env.OPENSEARCH_ENDPOINT,
      requestTimeout: 5000,
    });
  }
  return client;
}

function sources(response) {
  const body = response.body || response;
  return (body.hits?.hits || []).map((hit) => hit._source);
}

async function documents(os, index, query, size = 10000) {
  return sources(await os.search({ index, body: { size, query } }));
}

function requestedDates(checkIn, checkOut) {
  const dates = [];
  const cursor = new Date(`${checkIn}T00:00:00.000Z`);
  const end = new Date(`${checkOut}T00:00:00.000Z`);
  while (cursor < end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function parseAmenities(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return String(value).split(',').map((item) => item.trim()).filter(Boolean);
  }
}

function imageUrl(value, baseUrl = process.env.CDN_BASE_URL || '') {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return value;
  const key = String(value).replace(/^\/+/, '').replace(/^images\//, '');
  return `${baseUrl.replace(/\/$/, '')}/images/${key}`;
}

function assembleSearchResults(
  { hotels, roomTypes, rates, inventories, images },
  { checkIn, checkOut, minPrice, maxPrice }
) {
  const dates = requestedDates(checkIn, checkOut);
  const hotelById = new Map(
    hotels
      .filter((hotel) => !hotel.deleted_at)
      .map((hotel) => [Number(hotel.hotel_id), hotel])
  );
  const primaryImageByHotel = new Map();
  for (const item of images) {
    if ((item.is_primary === true || Number(item.is_primary) === 1) && item.image_url) {
      primaryImageByHotel.set(Number(item.hotel_id), item.image_url);
    }
  }

  const ratesByRoom = new Map();
  for (const rate of rates) {
    const key = `${Number(rate.hotel_id)}:${Number(rate.room_type_id)}`;
    if (!ratesByRoom.has(key)) ratesByRoom.set(key, new Map());
    ratesByRoom.get(key).set(String(rate.date).slice(0, 10), Number(rate.nightly_rate));
  }
  const inventoryByRoom = new Map();
  for (const inventory of inventories) {
    const key = `${Number(inventory.hotel_id)}:${Number(inventory.room_type_id)}`;
    if (!inventoryByRoom.has(key)) inventoryByRoom.set(key, new Map());
    inventoryByRoom.get(key).set(String(inventory.date).slice(0, 10), {
      total: Number(inventory.total_inventory),
      reserved: Number(inventory.total_reserved),
    });
  }

  const minimumPrice = minPrice === null || minPrice === undefined || minPrice === ''
    ? null : Number(minPrice);
  const maximumPrice = maxPrice === null || maxPrice === undefined || maxPrice === ''
    ? null : Number(maxPrice);

  const results = [];
  for (const roomType of roomTypes) {
    const hotelId = Number(roomType.hotel_id);
    const roomTypeId = Number(roomType.room_type_id);
    const hotel = hotelById.get(hotelId);
    if (!hotel) continue;

    const key = `${hotelId}:${roomTypeId}`;
    const roomRates = ratesByRoom.get(key);
    const roomInventory = inventoryByRoom.get(key);
    if (!roomRates || !roomInventory) continue;

    const nightlyRates = [];
    const availability = [];
    let complete = true;
    for (const date of dates) {
      const rate = roomRates.get(date);
      const inventory = roomInventory.get(date);
      if (!Number.isFinite(rate) || !inventory) {
        complete = false;
        break;
      }
      const available = inventory.total - inventory.reserved;
      if (available <= 0) {
        complete = false;
        break;
      }
      nightlyRates.push(rate);
      availability.push(available);
    }
    if (!complete || nightlyRates.length !== dates.length) continue;

    const nightlyRate = Math.min(...nightlyRates);
    if (minimumPrice !== null && nightlyRate < minimumPrice) continue;
    if (maximumPrice !== null && nightlyRate > maximumPrice) continue;

    results.push({
      hotel_id: hotelId,
      name: hotel.name,
      location: hotel.location,
      description: hotel.description,
      stars: Number(hotel.stars),
      room_type_id: roomTypeId,
      room_type_name: roomType.name,
      max_occupancy: Number(roomType.max_occupancy),
      amenities: parseAmenities(roomType.amenities),
      nightly_rate: nightlyRate,
      available_rooms_count: Math.min(...availability),
      primary_image_url: imageUrl(primaryImageByHotel.get(hotelId)),
    });
  }

  return results.sort((left, right) =>
    left.hotel_id - right.hotel_id || left.nightly_rate - right.nightly_rate
  );
}

async function searchHotels(criteria, os = getClient()) {
  const hotels = await documents(os, 'hotel', {
    bool: {
      must: [{
        multi_match: {
          query: criteria.location,
          fields: ['location^3', 'name^2', 'description'],
          fuzziness: 'AUTO',
        },
      }],
      must_not: [{ exists: { field: 'deleted_at' } }],
    },
  });
  const hotelIds = hotels.map((hotel) => Number(hotel.hotel_id)).filter(Number.isFinite);
  if (hotelIds.length === 0) return [];

  const roomTypes = await documents(os, 'room_type', {
    bool: {
      filter: [
        { terms: { hotel_id: hotelIds } },
        { range: { max_occupancy: { gte: Number(criteria.guests) } } },
      ],
    },
  });
  const roomTypeIds = roomTypes.map((room) => Number(room.room_type_id)).filter(Number.isFinite);
  if (roomTypeIds.length === 0) return [];

  const dateFilter = { range: { date: { gte: criteria.checkIn, lt: criteria.checkOut } } };
  const [rates, inventories, images] = await Promise.all([
    documents(os, 'room_type_rate', {
      bool: { filter: [{ terms: { room_type_id: roomTypeIds } }, dateFilter] },
    }),
    documents(os, 'room_type_inventory', {
      bool: { filter: [{ terms: { room_type_id: roomTypeIds } }, dateFilter] },
    }),
    documents(os, 'hotel_images', {
      bool: { filter: [{ terms: { hotel_id: hotelIds } }] },
    }),
  ]);

  return assembleSearchResults(
    { hotels, roomTypes, rates, inventories, images },
    criteria
  );
}

module.exports = {
  getClient,
  searchHotels,
  assembleSearchResults,
  requestedDates,
  parseAmenities,
  imageUrl,
};
