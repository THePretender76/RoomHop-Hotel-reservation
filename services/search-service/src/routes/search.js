'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { validateSearchParams } = require('../middleware/validate');
const logger = require('../logger');

// CloudFront CDN base URL for hotel images
const CDN_BASE_URL = process.env.CDN_BASE_URL || '';

// ==============================
// GET /v1/search
// ==============================
router.get('/', async (req, res) => {
  // 1. Validate presence of required params
  const missing = validateSearchParams(req.query);
  if (missing.length > 0) {
    return res.status(400).json({
      error: `Missing required query parameters: ${missing.join(', ')}`,
    });
  }

  const { location, checkIn, checkOut, guests, minPrice, maxPrice } = req.query;

  // 2. Validate date format (YYYY-MM-DD)
  const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
  if (!ISO_DATE.test(checkIn) || !ISO_DATE.test(checkOut)) {
    return res.status(400).json({
      error: 'checkIn and checkOut must be in YYYY-MM-DD format',
    });
  }

  const checkInDate = new Date(checkIn);
  const checkOutDate = new Date(checkOut);

  // 3. Reject checkIn in the past
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (checkInDate < today) {
    return res.status(400).json({ error: 'checkIn cannot be in the past' });
  }

  // 4. Reject checkIn >= checkOut
  if (checkInDate >= checkOutDate) {
    return res.status(400).json({ error: 'checkIn must be before checkOut' });
  }

  // 5. Parse guests as integer
  const guestsInt = parseInt(guests, 10);
  if (isNaN(guestsInt) || guestsInt < 1) {
    return res.status(400).json({ error: 'guests must be a positive integer' });
  }

  // 6. Parse optional price filters
  const minPriceVal = minPrice != null && minPrice !== '' ? parseFloat(minPrice) : null;
  const maxPriceVal = maxPrice != null && maxPrice !== '' ? parseFloat(maxPrice) : null;

  // 7. Build and execute the availability SQL query
  const sql = `
    SELECT
        h.hotel_id,
        h.name,
        h.location,
        h.description,
        rt.room_type_id,
        rt.name              AS room_type_name,
        rt.max_occupancy,
        rt.amenities,
        MIN(rtr.nightly_rate) AS nightly_rate,
        MIN(rti.total_inventory - rti.total_reserved) AS available_rooms_count,
        hi.image_url         AS primary_image_url
    FROM hotel h
    JOIN room_type rt        ON rt.hotel_id = h.hotel_id
    JOIN room_type_inventory rti
        ON rti.hotel_id      = h.hotel_id
        AND rti.room_type_id = rt.room_type_id
        AND rti.date >= ?
        AND rti.date <  ?
    JOIN room_type_rate rtr
        ON rtr.hotel_id      = h.hotel_id
        AND rtr.room_type_id = rt.room_type_id
        AND rtr.date >= ?
        AND rtr.date <  ?
    LEFT JOIN hotel_images hi
        ON hi.hotel_id       = h.hotel_id
        AND hi.is_primary    = TRUE
    WHERE h.location LIKE CONCAT('%', ?, '%')
    GROUP BY h.hotel_id, rt.room_type_id, hi.image_url
    HAVING available_rooms_count >= ?
       AND (? IS NULL OR MIN(rtr.nightly_rate) >= ?)
       AND (? IS NULL OR MIN(rtr.nightly_rate) <= ?)
       AND COUNT(DISTINCT rti.date) = DATEDIFF(?, ?)
    ORDER BY h.hotel_id, nightly_rate ASC;
  `;

  const params = [
    checkIn, checkOut,
    checkIn, checkOut,
    location,
    guestsInt,
    minPriceVal, minPriceVal,
    maxPriceVal, maxPriceVal,
    checkOut, checkIn,
  ];

  try {
    const [rows] = await db.query(sql, params);

    // 8. Map image URLs using CloudFront CDN
    const results = rows.map((row) => ({
      ...row,
      primary_image_url: row.primary_image_url
        ? `${CDN_BASE_URL}/images/${row.primary_image_url}`
        : null,
    }));

    return res.status(200).json({ results });
  } catch (err) {
    logger.error('Search query failed', { error: err.message, stack: err.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
