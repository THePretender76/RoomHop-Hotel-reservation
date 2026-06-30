'use strict';

const express = require('express');
const router = express.Router();
const db = require('../db');
const { searchHotels } = require('../opensearch');
const { validateSearchParams } = require('../middleware/validate');
const logger = require('../logger');

// Use OpenSearch when endpoint is configured and not 'not-used'
const USE_OPENSEARCH = process.env.OPENSEARCH_ENDPOINT
  && process.env.OPENSEARCH_ENDPOINT !== 'https://not-used'
  && !process.env.OPENSEARCH_ENDPOINT.includes('not-used');

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

  try {
    let results;

    if (USE_OPENSEARCH) {
      // ── OpenSearch path (Iteration 2) ──────────────────────────────────────
      logger.info('Searching via OpenSearch', { location, checkIn, checkOut, guests });
      const hits = await searchHotels({ location, checkIn, checkOut, guests, minPrice, maxPrice });

      // Aggregate hits by hotel + room_type (DMS syncs per-date rows)
      const grouped = {};
      for (const hit of hits) {
        const key = `${hit.hotel_id}-${hit.room_type_id}`;
        if (!grouped[key]) {
          grouped[key] = {
            hotel_id: hit.hotel_id,
            name: hit.hotel_name,
            location: hit.hotel_location,
            description: hit.hotel_description,
            room_type_id: hit.room_type_id,
            room_type_name: hit.room_type_name,
            max_occupancy: hit.max_occupancy,
            amenities: hit.amenities,
            nightly_rate: hit.nightly_rate,
            primary_image_url: hit.primary_image_url
              ? `/images/${hit.primary_image_url}` : null,
            available_rooms_count: hit.total_inventory - hit.total_reserved,
            date_count: 0,
          };
        }
        grouped[key].date_count++;
        // Track minimum availability across dates
        const avail = hit.total_inventory - hit.total_reserved;
        if (avail < grouped[key].available_rooms_count) {
          grouped[key].available_rooms_count = avail;
        }
      }

      // Filter: need availability for ALL requested nights
      const nights = Math.ceil((checkOutDate - checkInDate) / (1000 * 60 * 60 * 24));
      results = Object.values(grouped).filter((r) =>
        r.date_count >= nights && r.available_rooms_count >= guestsInt
      );
    } else {
      // ── MySQL fallback (same as Iteration 1) ───────────────────────────────
      logger.info('Searching via MySQL (OpenSearch not configured)', { location });
      const minPriceVal = minPrice != null && minPrice !== '' ? parseFloat(minPrice) : null;
      const maxPriceVal = maxPrice != null && maxPrice !== '' ? parseFloat(maxPrice) : null;

      const sql = `
        SELECT
            h.hotel_id, h.name, h.location, h.description,
            rt.room_type_id, rt.name AS room_type_name, rt.max_occupancy, rt.amenities,
            MIN(rtr.nightly_rate) AS nightly_rate,
            MIN(rti.total_inventory - rti.total_reserved) AS available_rooms_count,
            hi.image_url AS primary_image_url
        FROM hotel h
        JOIN room_type rt ON rt.hotel_id = h.hotel_id
        JOIN room_type_inventory rti
            ON rti.hotel_id = h.hotel_id AND rti.room_type_id = rt.room_type_id
            AND rti.date >= ? AND rti.date < ?
        JOIN room_type_rate rtr
            ON rtr.hotel_id = h.hotel_id AND rtr.room_type_id = rt.room_type_id
            AND rtr.date >= ? AND rtr.date < ?
        LEFT JOIN hotel_images hi ON hi.hotel_id = h.hotel_id AND hi.is_primary = TRUE
        WHERE h.location LIKE CONCAT('%', ?, '%')
        GROUP BY h.hotel_id, rt.room_type_id, hi.image_url
        HAVING available_rooms_count >= ?
           AND (? IS NULL OR MIN(rtr.nightly_rate) >= ?)
           AND (? IS NULL OR MIN(rtr.nightly_rate) <= ?)
           AND COUNT(DISTINCT rti.date) = DATEDIFF(?, ?)
        ORDER BY h.hotel_id, nightly_rate ASC;
      `;

      const params = [
        checkIn, checkOut, checkIn, checkOut, location,
        guestsInt, minPriceVal, minPriceVal, maxPriceVal, maxPriceVal, checkOut, checkIn,
      ];

      const [rows] = await db.query(sql, params);
      results = rows.map((row) => ({
        ...row,
        primary_image_url: row.primary_image_url ? `/images/${row.primary_image_url}` : null,
      }));
    }

    return res.status(200).json({ results });
  } catch (err) {
    logger.error('Search query failed', { error: err.message, stack: err.stack });
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
