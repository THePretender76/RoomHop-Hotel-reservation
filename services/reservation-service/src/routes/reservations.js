'use strict';

const express = require('express');
const { validateReservationBody } = require('../middleware/validate');
const { createReservation, cancelReservation } = require('../services/reservationService');
const { publishEvent } = require('../eventPublisher');
const db = require('../db');
const logger = require('../logger');

const router = express.Router();

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requiredIdentity(user) {
  if (!user?.sub || !user?.email) {
    throw httpError(401, 'A Cognito identity with a verified email is required');
  }
  return { sub: user.sub, email: String(user.email).trim().toLowerCase() };
}

async function upsertAuthenticatedGuest(body, user) {
  const identity = requiredIdentity(user);
  const firstName = String(body.guest_first_name || '').trim();
  const lastName = String(body.guest_last_name || '').trim();
  if (!firstName || !lastName) {
    throw httpError(422, 'Guest first name and last name are required');
  }

  const [matches] = await db.query(
    `SELECT guest_id, cognito_sub
       FROM guest
      WHERE cognito_sub = ? OR email = ?
      ORDER BY (cognito_sub = ?) DESC
      LIMIT 1`,
    [identity.sub, identity.email, identity.sub]
  );

  if (matches.length) {
    const guest = matches[0];
    if (guest.cognito_sub && guest.cognito_sub !== identity.sub) {
      throw httpError(409, 'This email is already linked to another account');
    }
    await db.query(
      `UPDATE guest
          SET cognito_sub = ?, email = ?, first_name = ?, last_name = ?,
              phone = COALESCE(?, phone),
              date_of_birth = COALESCE(?, date_of_birth),
              nationality = COALESCE(?, nationality)
        WHERE guest_id = ?`,
      [
        identity.sub,
        identity.email,
        firstName,
        lastName,
        body.guest_phone || null,
        body.guest_dob || null,
        body.guest_nationality || null,
        guest.guest_id,
      ]
    );
    return guest.guest_id;
  }

  const [insertResult] = await db.query(
    `INSERT INTO guest
       (first_name, last_name, email, cognito_sub, phone, date_of_birth, nationality)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      firstName,
      lastName,
      identity.email,
      identity.sub,
      body.guest_phone || null,
      body.guest_dob || null,
      body.guest_nationality || null,
    ]
  );
  return insertResult.insertId;
}

async function bookingNotificationDetails(reservation) {
  const [rows] = await db.query(
    `SELECT g.email AS guest_email,
            CONCAT(g.first_name, ' ', g.last_name) AS guest_name,
            h.name AS hotel_name,
            rt.name AS room_type_name
       FROM guest g
       JOIN hotel h ON h.hotel_id = ?
       JOIN room_type rt ON rt.room_type_id = ?
      WHERE g.guest_id = ?
      LIMIT 1`,
    [reservation.hotel_id, reservation.room_type_id, reservation.guest_id]
  );
  if (!rows.length) throw httpError(500, 'Booking notification details are unavailable');
  return rows[0];
}

router.post('/', async (req, res) => {
  const missingFields = validateReservationBody(req.body);
  if (missingFields.length > 0) {
    return res.status(422).json({ error: 'Missing required fields', fields: missingFields });
  }

  try {
    const guestId = await upsertAuthenticatedGuest(req.body, req.user);
    const result = await createReservation(
      { ...req.body, guest_id: guestId },
      req.headers['idempotency-key'] || null
    );
    const reservation = result.reservation;
    const notification = await bookingNotificationDetails(reservation);

    // Replays also republish the event. If a previous attempt committed the
    // booking but failed before EventBridge accepted it, a retry repairs the
    // notification path instead of silently returning the stored booking.
    await publishEvent('BookingConfirmed', {
      reservationId: reservation.reservation_id,
      guestEmail: notification.guest_email,
      guestName: notification.guest_name || 'Guest',
      hotelId: reservation.hotel_id,
      hotelName: notification.hotel_name,
      roomType: notification.room_type_name,
      checkIn: reservation.start_date,
      checkOut: reservation.end_date,
      totalAmount: reservation.amount,
      currency: 'EUR',
    });

    logger.info(result.existing ? 'Idempotent booking replayed' : 'Reservation created', {
      reservationId: reservation.reservation_id,
      guestId: reservation.guest_id,
      hotelId: reservation.hotel_id,
    });
    return res.status(result.existing ? 200 : 201).json(reservation);
  } catch (error) {
    const status = error.status || 500;
    logger.error('Reservation creation failed', { error: error.message, stack: error.stack });
    return res.status(status).json({ error: error.message || 'Internal server error' });
  }
});

router.get('/', async (req, res) => {
  try {
    const identity = requiredIdentity(req.user);
    const [rows] = await db.query(
      `SELECT r.*, h.name AS hotel_name, rt.name AS room_type_name
         FROM reservation r
         JOIN hotel h ON h.hotel_id = r.hotel_id
         JOIN room_type rt ON rt.room_type_id = r.room_type_id
         JOIN guest g ON g.guest_id = r.guest_id
        WHERE g.cognito_sub = ?
        ORDER BY r.created_at DESC`,
      [identity.sub]
    );
    return res.status(200).json({ reservations: rows });
  } catch (error) {
    const status = error.status || 500;
    logger.error('Guest reservations lookup failed', { error: error.message });
    return res.status(status).json({ error: error.message || 'Internal server error' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const identity = requiredIdentity(req.user);
    const [rows] = await db.query(
      `SELECT r.*, h.name AS hotel_name, rt.name AS room_type_name
         FROM reservation r
         JOIN hotel h ON h.hotel_id = r.hotel_id
         JOIN room_type rt ON rt.room_type_id = r.room_type_id
         JOIN guest g ON g.guest_id = r.guest_id
        WHERE r.reservation_id = ? AND g.cognito_sub = ?`,
      [req.params.id, identity.sub]
    );
    if (!rows.length) return res.status(404).json({ error: 'Reservation not found' });
    return res.status(200).json({ reservation: rows[0] });
  } catch (error) {
    const status = error.status || 500;
    logger.error('Reservation detail lookup failed', {
      error: error.message,
      reservationId: req.params.id,
    });
    return res.status(status).json({ error: error.message || 'Internal server error' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const identity = requiredIdentity(req.user);
    const reservation = await cancelReservation(req.params.id, identity.sub);
    await publishEvent('BookingCancelled', {
      reservationId: Number(req.params.id),
      guestEmail: reservation.guest_email,
      guestName: reservation.guest_name || 'Guest',
      hotelId: reservation.hotel_id,
      hotelName: reservation.hotel_name,
      roomType: reservation.room_type_name,
      checkIn: reservation.start_date,
      checkOut: reservation.end_date,
      totalAmount: reservation.amount,
      currency: 'EUR',
    });
    return res.status(200).json({ reservation });
  } catch (error) {
    const status = error.status && [401, 403, 404, 409].includes(error.status)
      ? error.status
      : 500;
    logger.error('Reservation cancellation failed', {
      error: error.message,
      reservationId: req.params.id,
    });
    return res.status(status).json({ error: error.message || 'Internal server error' });
  }
});

module.exports = router;
module.exports.requiredIdentity = requiredIdentity;
module.exports.upsertAuthenticatedGuest = upsertAuthenticatedGuest;
