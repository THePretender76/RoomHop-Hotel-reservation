'use strict';

// ======================================================
// RESERVATION SERVICE
// Encapsulates transaction logic for reservation creation
// and cancellation. Both operations use explicit
// BEGIN / COMMIT / ROLLBACK via db.getConnection().
//
// Error contract: throws plain objects { status, message }
// so route handlers can map them directly to HTTP responses.
// ======================================================

const db = require('../db');

// -------------------------------------------------------
// createReservation
// -------------------------------------------------------
// data = { hotel_id, room_type_id, guest_id, start_date, end_date, room_count }
// idempotencyKey = string | null | undefined
//
// Returns:
//   { existing: true,  reservation: <existing row> }         – idempotent replay
//   { existing: false, reservation: { reservation_id, ...data, amount, status } }
// -------------------------------------------------------
async function createReservation(data, idempotencyKey) {
  const { hotel_id, room_type_id, guest_id, start_date, end_date, room_count } = data;

  // ── 1. Idempotency check (outside transaction, no lock needed) ──
  if (idempotencyKey) {
    const [existing] = await db.query(
      'SELECT * FROM reservation WHERE idempotency_key = ? LIMIT 1',
      [idempotencyKey]
    );
    if (existing.length > 0) {
      return { existing: true, reservation: existing[0] };
    }
  }

  // ── 2. Acquire connection and start transaction ──
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // ── 3. SELECT FOR UPDATE on all inventory rows in the date range ──
    const [inventoryRows] = await conn.query(
      `SELECT *
         FROM room_type_inventory
        WHERE hotel_id      = ?
          AND room_type_id  = ?
          AND date         >= ?
          AND date          < ?
        FOR UPDATE`,
      [hotel_id, room_type_id, start_date, end_date]
    );

    // ── 4. Verify every night in the range has an inventory row ──
    const [[{ nightCount }]] = await conn.query(
      'SELECT DATEDIFF(?, ?) AS nightCount',
      [end_date, start_date]
    );

    if (inventoryRows.length !== nightCount) {
      throw {
        status: 409,
        message: 'Insufficient availability for the requested dates and room count',
      };
    }

    // ── 5. Check MIN(total_inventory - total_reserved) >= room_count ──
    const minAvailable = Math.min(
      ...inventoryRows.map((r) => r.total_inventory - r.total_reserved)
    );

    if (minAvailable < room_count) {
      throw {
        status: 409,
        message: 'Insufficient availability for the requested dates and room count',
      };
    }

    // ── 6. Fetch nightly rates and compute total amount ──
    const [rateRows] = await conn.query(
      `SELECT nightly_rate
         FROM room_type_rate
        WHERE hotel_id     = ?
          AND room_type_id = ?
          AND date        >= ?
          AND date         < ?`,
      [hotel_id, room_type_id, start_date, end_date]
    );

    const amount = rateRows.reduce(
      (sum, r) => sum + Number(r.nightly_rate) * room_count,
      0
    );

    // ── 7. INSERT reservation ──
    const [insertResult] = await conn.query(
      `INSERT INTO reservation
         (hotel_id, room_type_id, guest_id, start_date, end_date,
          room_count, amount, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        hotel_id,
        room_type_id,
        guest_id,
        start_date,
        end_date,
        room_count,
        amount.toFixed(2),
        idempotencyKey || null,
      ]
    );

    const reservationId = insertResult.insertId;

    // ── 8. Increment total_reserved for each inventory row ──
    await conn.query(
      `UPDATE room_type_inventory
          SET total_reserved = total_reserved + ?
        WHERE hotel_id     = ?
          AND room_type_id = ?
          AND date        >= ?
          AND date         < ?`,
      [room_count, hotel_id, room_type_id, start_date, end_date]
    );

    // ── 9. Commit and return ──
    await conn.commit();

    return {
      existing: false,
      reservation: {
        reservation_id: reservationId,
        hotel_id,
        room_type_id,
        guest_id,
        start_date,
        end_date,
        room_count,
        amount: parseFloat(amount.toFixed(2)),
        status: 'CONFIRMED',
        idempotency_key: idempotencyKey || null,
      },
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// -------------------------------------------------------
// cancelReservation
// -------------------------------------------------------
// reservationId = integer
//
// Returns the updated reservation row on success.
// Throws { status, message } on validation failure.
// -------------------------------------------------------
async function cancelReservation(reservationId) {
  // ── 1. Look up the reservation (outside transaction) ──
  const [rows] = await db.query(
    'SELECT * FROM reservation WHERE reservation_id = ? LIMIT 1',
    [reservationId]
  );

  if (rows.length === 0) {
    throw { status: 404, message: 'Reservation not found' };
  }

  const reservation = rows[0];

  // ── 2. Guard against already-cancelled reservations ──
  if (reservation.status === 'CANCELLED') {
    throw { status: 409, message: 'Reservation is already cancelled' };
  }

  // ── 3. Enforce 3-day cancellation window ──
  const createdAt = new Date(reservation.created_at);
  const now = new Date();
  const diffMs = now - createdAt;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays > 3) {
    throw {
      status: 403,
      message: 'Cancellation window has closed (3-day limit exceeded)',
    };
  }

  // ── 4. Begin transaction ──
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // ── 5. UPDATE reservation status to CANCELLED ──
    await conn.query(
      `UPDATE reservation
          SET status     = 'CANCELLED',
              updated_at = NOW()
        WHERE reservation_id = ?`,
      [reservationId]
    );

    // ── 6. Decrement total_reserved for each inventory row ──
    await conn.query(
      `UPDATE room_type_inventory
          SET total_reserved = total_reserved - ?
        WHERE hotel_id     = ?
          AND room_type_id = ?
          AND date        >= ?
          AND date         < ?`,
      [
        reservation.room_count,
        reservation.hotel_id,
        reservation.room_type_id,
        reservation.start_date,
        reservation.end_date,
      ]
    );

    // ── 7. Commit ──
    await conn.commit();

    // Return the updated reservation
    return {
      ...reservation,
      status: 'CANCELLED',
      updated_at: new Date(),
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { createReservation, cancelReservation };
