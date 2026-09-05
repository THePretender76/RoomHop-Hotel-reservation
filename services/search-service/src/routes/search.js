'use strict';

const express = require('express');
const db = require('../db');
const { searchHotels, imageUrl, parseAmenities } = require('../opensearch');
const { validateSearchParams } = require('../middleware/validate');
const logger = require('../logger');

const router = express.Router();

const MYSQL_SEARCH_SQL = `
  SELECT
      h.hotel_id,
      h.name,
      h.location,
      h.description,
      h.stars,
      rt.room_type_id,
      rt.name AS room_type_name,
      rt.max_occupancy,
      rt.amenities,
      MIN(rtr.nightly_rate) AS nightly_rate,
      MIN(rti.total_inventory - rti.total_reserved) AS available_rooms_count,
      hi.image_url AS primary_image_url
  FROM hotel h
  JOIN room_type rt
    ON rt.hotel_id = h.hotel_id
  JOIN room_type_inventory rti
    ON rti.hotel_id = h.hotel_id
   AND rti.room_type_id = rt.room_type_id
   AND rti.date >= ?
   AND rti.date < ?
  JOIN room_type_rate rtr
    ON rtr.hotel_id = rti.hotel_id
   AND rtr.room_type_id = rti.room_type_id
   AND rtr.date = rti.date
  LEFT JOIN hotel_images hi
    ON hi.hotel_id = h.hotel_id
   AND hi.is_primary = TRUE
  WHERE h.deleted_at IS NULL
    AND h.location LIKE CONCAT('%', ?, '%')
    AND rt.max_occupancy >= ?
  GROUP BY
    h.hotel_id, h.name, h.location, h.description, h.stars,
    rt.room_type_id, rt.name, rt.max_occupancy, rt.amenities, hi.image_url
  HAVING available_rooms_count > 0
     AND (? IS NULL OR MIN(rtr.nightly_rate) >= ?)
     AND (? IS NULL OR MIN(rtr.nightly_rate) <= ?)
     AND COUNT(DISTINCT rti.date) = DATEDIFF(?, ?)
  ORDER BY h.hotel_id, nightly_rate ASC
`;

function openSearchConfigured() {
  const endpoint = process.env.OPENSEARCH_ENDPOINT || '';
  return /^https:\/\//.test(endpoint) && !endpoint.includes('not-used');
}

function validIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function searchMySql(criteria, database = db) {
  const params = [
    criteria.checkIn,
    criteria.checkOut,
    criteria.location,
    criteria.guests,
    criteria.minPrice,
    criteria.minPrice,
    criteria.maxPrice,
    criteria.maxPrice,
    criteria.checkOut,
    criteria.checkIn,
  ];
  const [rows] = await database.query(MYSQL_SEARCH_SQL, params);
  return rows.map((row) => ({
    ...row,
    amenities: parseAmenities(row.amenities),
    primary_image_url: imageUrl(row.primary_image_url),
  }));
}

router.get('/', async (req, res) => {
  const missing = validateSearchParams(req.query);
  if (missing.length > 0) {
    return res.status(400).json({
      error: `Missing required query parameters: ${missing.join(', ')}`,
    });
  }

  const { location, checkIn, checkOut, guests, minPrice, maxPrice } = req.query;
  if (!validIsoDate(checkIn) || !validIsoDate(checkOut)) {
    return res.status(400).json({ error: 'checkIn and checkOut must be valid YYYY-MM-DD dates' });
  }

  const checkInDate = new Date(`${checkIn}T00:00:00.000Z`);
  const checkOutDate = new Date(`${checkOut}T00:00:00.000Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (checkInDate < today) {
    return res.status(400).json({ error: 'checkIn cannot be in the past' });
  }
  if (checkInDate >= checkOutDate) {
    return res.status(400).json({ error: 'checkIn must be before checkOut' });
  }

  const guestsValue = Number(guests);
  if (!Number.isInteger(guestsValue) || guestsValue < 1 || guestsValue > 50) {
    return res.status(400).json({ error: 'guests must be an integer between 1 and 50' });
  }
  const minPriceValue = minPrice === undefined || minPrice === '' ? null : Number(minPrice);
  const maxPriceValue = maxPrice === undefined || maxPrice === '' ? null : Number(maxPrice);
  if ((minPriceValue !== null && (!Number.isFinite(minPriceValue) || minPriceValue < 0))
      || (maxPriceValue !== null && (!Number.isFinite(maxPriceValue) || maxPriceValue < 0))) {
    return res.status(400).json({ error: 'Price filters must be positive numbers' });
  }
  if (minPriceValue !== null && maxPriceValue !== null && minPriceValue > maxPriceValue) {
    return res.status(400).json({ error: 'minPrice cannot exceed maxPrice' });
  }

  const criteria = {
    location: String(location).trim(),
    checkIn,
    checkOut,
    guests: guestsValue,
    minPrice: minPriceValue,
    maxPrice: maxPriceValue,
  };

  try {
    if (openSearchConfigured()) {
      try {
        const results = await searchHotels(criteria);
        return res.status(200).json({ results, source: 'opensearch' });
      } catch (error) {
        logger.warn('OpenSearch unavailable; using the authoritative MySQL fallback', {
          error: error.message,
        });
      }
    }

    const results = await searchMySql(criteria);
    return res.status(200).json({ results, source: 'mysql' });
  } catch (error) {
    logger.error('Search failed', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
module.exports.MYSQL_SEARCH_SQL = MYSQL_SEARCH_SQL;
module.exports.searchMySql = searchMySql;
module.exports.validIsoDate = validIsoDate;
