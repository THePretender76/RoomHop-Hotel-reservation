'use strict';

// ======================================================
// RESERVATIONS ROUTER  –  /v1/reservations
//
// POST   /          – create a reservation (idempotent)
// GET    /          – list reservations for a guest
// GET    /:id       – get full reservation detail
// DELETE /:id       – cancel a reservation
// ======================================================

const express = require('express');
const router = express.Router();

const { validateReservationBody } = require('../../middleware/validate');
const { createReservation, cancelReservation } = require('../../services/reservationService');
const { publish } = require('../../services/kafkaProducer');
const db = require('../../db');
const logger = require('../../logger');

const TOPIC = 'hotel.events.reservations';

// -------------------------------------------------------
// POST /v1/reservations
// Creates a new reservation.  Idempotent via Idempotency-Key header.
// -------------------------------------------------------
router.post('/', async (req, res) => {
  // 1. Validate body
  const missingFields = validateReservationBody(req.body);
  if (missingFields.length > 0) {
    return res.status(422).json({ error: 'Missing required fields', fields: missingFields });
  }

  // 2. Read idempotency key from header
  const idempotencyKey = req.headers['idempotency-key'] || null;

  try {
    // 2b. Create or find guest by email
    let guestId = req.body.guest_id;
    if (req.body.guest_email) {
      const [existingGuests] = await db.query(
        'SELECT guest_id FROM guest WHERE email = ? LIMIT 1',
        [req.body.guest_email]
      );
      if (existingGuests.length > 0) {
        guestId = existingGuests[0].guest_id;
        // Update guest info if provided
        await db.query(
          'UPDATE guest SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), phone = COALESCE(?, phone), date_of_birth = COALESCE(?, date_of_birth), nationality = COALESCE(?, nationality) WHERE guest_id = ?',
          [req.body.guest_first_name || null, req.body.guest_last_name || null, req.body.guest_phone || null, req.body.guest_dob || null, req.body.guest_nationality || null, guestId]
        );
      } else {
        // Insert new guest
        const [insertResult] = await db.query(
          'INSERT INTO guest (first_name, last_name, email, phone, date_of_birth, nationality) VALUES (?, ?, ?, ?, ?, ?)',
          [req.body.guest_first_name || '', req.body.guest_last_name || '', req.body.guest_email, req.body.guest_phone || null, req.body.guest_dob || null, req.body.guest_nationality || null]
        );
        guestId = insertResult.insertId;
      }
    }

    // Override guest_id in the body with the real one
    const reservationData = { ...req.body, guest_id: guestId };

    const result = await createReservation(reservationData, idempotencyKey);

    // 3a. Idempotent replay – already created, return 200
    if (result.existing === true) {
      logger.info('Idempotent replay returned', { reservationId: result.reservation.reservation_id, requestId: req.requestId });
      return res.status(200).json(result.reservation);
    }

    // 3b. Newly created – publish confirmed event (fire-and-forget)
    const reservation = result.reservation;

    logger.info('Reservation created', {
      reservationId: reservation.reservation_id,
      guestId: reservation.guest_id,
      hotelId: reservation.hotel_id,
      requestId: req.requestId,
    });

    publish(TOPIC, {
      eventType: 'reservation.confirmed',
      reservationId: reservation.reservation_id,
      guestId: reservation.guest_id,
      guestEmail: req.body.guest_email || null,
      hotelName: req.body.hotel_name || null,
      roomTypeName: req.body.room_type_name || null,
      startDate: reservation.start_date,
      endDate: reservation.end_date,
      roomCount: reservation.room_count,
      amount: reservation.amount,
      occurredAt: new Date().toISOString(),
    });

    return res.status(201).json(reservation);
  } catch (err) {
    const status = err.status || 500;
    logger.error('Reservation creation failed', { error: err.message, stack: err.stack, requestId: req.requestId });
    return res.status(status).json({ error: err.message || 'Internal server error' });
  }
});

// -------------------------------------------------------
// GET /v1/reservations
// Lists all reservations for a given guest, newest first.
// Requires ?guest_id query parameter.
// -------------------------------------------------------
router.get('/', async (req, res) => {
  const { guest_id } = req.query;

  if (!guest_id) {
    return res.status(400).json({ error: 'guest_id query parameter is required' });
  }

  try {
    const [rows] = await db.query(
      `SELECT r.*, h.name AS hotel_name, rt.name AS room_type_name
         FROM reservation r
         JOIN hotel     h  ON h.hotel_id      = r.hotel_id
         JOIN room_type rt ON rt.room_type_id = r.room_type_id
        WHERE r.guest_id = ?
        ORDER BY r.created_at DESC`,
      [guest_id]
    );
    return res.status(200).json({ reservations: rows });
  } catch (err) {
    logger.error('Guest reservations lookup failed', { error: err.message, guestId: guest_id, requestId: req.requestId });
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// -------------------------------------------------------
// GET /v1/reservations/:id
// Returns full reservation detail with hotel and room type names.
// -------------------------------------------------------
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.*, h.name AS hotel_name, rt.name AS room_type_name
         FROM reservation r
         JOIN hotel     h  ON h.hotel_id      = r.hotel_id
         JOIN room_type rt ON rt.room_type_id = r.room_type_id
        WHERE r.reservation_id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Reservation not found' });
    }

    return res.status(200).json({ reservation: rows[0] });
  } catch (err) {
    logger.error('Reservation detail lookup failed', { error: err.message, reservationId: req.params.id, requestId: req.requestId });
    return res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// -------------------------------------------------------
// DELETE /v1/reservations/:id
// Cancels a reservation. Maps service errors to HTTP codes.
// -------------------------------------------------------
router.delete('/:id', async (req, res) => {
  const id = req.params.id;

  try {
    const updatedReservation = await cancelReservation(id);

    logger.info('Reservation cancelled', { reservationId: id, requestId: req.requestId });

    // Publish cancellation event (fire-and-forget)
    publish(TOPIC, {
      eventType: 'reservation.cancelled',
      reservationId: id,
      guestId: updatedReservation.guest_id,
      guestEmail: null,
      occurredAt: new Date().toISOString(),
    });

    return res.status(200).json({ reservation: updatedReservation });
  } catch (err) {
    const status = err.status && [403, 404, 409].includes(err.status)
      ? err.status
      : 500;
    logger.error('Reservation cancellation failed', { error: err.message, reservationId: id, requestId: req.requestId });
    return res.status(status).json({ error: err.message || 'Internal server error' });
  }
});

module.exports = router;
