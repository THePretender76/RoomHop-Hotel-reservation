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
const logger = require('../logger');
const { SpanKind } = require('@opentelemetry/api');
const { withSpan } = require('../tracing');

// -------------------------------------------------------
// createReservation
// -------------------------------------------------------
async function createReservation(data, idempotencyKey) {
  const { hotel_id, room_type_id, guest_id, start_date, end_date, room_count } = data;

  // 1. Idempotency check (outside transaction, no lock needed)
  if (idempotencyKey) {
    const [existing] = await db.query(
      'SELECT * FROM reservation WHERE idempotency_key = ? AND guest_id = ? LIMIT 1',
      [idempotencyKey, guest_id]
    );
    if (existing.length > 0) {
      logger.debug('Idempotent replay', { idempotencyKey, reservationId: existing[0].reservation_id });
      return { existing: true, reservation: existing[0] };
    }
  }

  // 2. Acquire connection and start transaction
  return withSpan('mysql.transaction', {
    annotations: { operation: 'reservation_create' },
    errorType: (error) => error?.status ? 'business_error' : 'mysql_transaction_error',
  }, async () => {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

      // 3. SELECT FOR UPDATE on all inventory rows in the date range
      const [inventoryRows] = await withSpan('mysql.inventoryLock', {
        kind: SpanKind.CLIENT,
        annotations: { operation: 'inventory_lock' },
        errorType: 'mysql_inventory_lock_error',
      }, () => conn.query(
        `SELECT *
           FROM room_type_inventory
          WHERE hotel_id      = ?
            AND room_type_id  = ?
            AND date         >= ?
            AND date          < ?
          FOR UPDATE`,
        [hotel_id, room_type_id, start_date, end_date]
      ));

    // 4. Verify every night in the range has an inventory row
    const [[{ nightCount }]] = await conn.query(
      'SELECT DATEDIFF(?, ?) AS nightCount',
      [end_date, start_date]
    );

    if (inventoryRows.length !== nightCount) {
      logger.warn('Availability check failed', { hotelId: hotel_id, roomTypeId: room_type_id, reason: 'missing inventory rows' });
      throw {
        status: 409,
        message: 'Insufficient availability for the requested dates and room count',
      };
    }

    // 5. Check MIN(total_inventory - total_reserved) >= room_count
    const minAvailable = Math.min(
      ...inventoryRows.map((r) => r.total_inventory - r.total_reserved)
    );

    if (minAvailable < room_count) {
      logger.warn('Availability check failed', { hotelId: hotel_id, roomTypeId: room_type_id, minAvailable, requestedRooms: room_count });
      throw {
        status: 409,
        message: 'Insufficient availability for the requested dates and room count',
      };
    }

    // 6. Fetch nightly rates and compute total amount
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

      // 7. INSERT reservation
      const [insertResult] = await withSpan('mysql.createReservation', {
        kind: SpanKind.CLIENT,
        annotations: { operation: 'reservation_insert' },
        errorType: 'mysql_reservation_insert_error',
      }, () => conn.query(
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
      ));

    const reservationId = insertResult.insertId;

      // 8. Increment total_reserved for each inventory row
      await withSpan('mysql.updateInventory', {
        kind: SpanKind.CLIENT,
        annotations: { operation: 'inventory_update' },
        errorType: 'mysql_inventory_update_error',
      }, () => conn.query(
        `UPDATE room_type_inventory
            SET total_reserved = total_reserved + ?
          WHERE hotel_id     = ?
            AND room_type_id = ?
            AND date        >= ?
            AND date         < ?`,
        [room_count, hotel_id, room_type_id, start_date, end_date]
      ));

      // 9. Commit and return
      await withSpan('mysql.commit', {
        kind: SpanKind.CLIENT,
        annotations: { operation: 'reservation_commit' },
        errorType: 'mysql_commit_error',
      }, () => conn.commit());

    logger.info('Reservation committed', { reservationId, amount: parseFloat(amount.toFixed(2)), roomCount: room_count, guestId: guest_id });

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
      await withSpan('mysql.rollback', {
        kind: SpanKind.CLIENT,
        annotations: { operation: 'reservation_rollback' },
        errorType: 'mysql_rollback_error',
      }, () => conn.rollback());
      throw err;
    } finally {
      conn.release();
    }
  });
}

// -------------------------------------------------------
// cancelReservation
// -------------------------------------------------------
async function cancelReservation(reservationId, cognitoSub) {
  return withSpan('mysql.transaction', {
    annotations: { operation: 'reservation_cancel' },
    errorType: (error) => error?.status ? 'business_error' : 'mysql_transaction_error',
  }, async () => {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();

    // Lock the reservation before checking its state so concurrent requests
    // cannot both decrement inventory. Ownership is bound to the JWT subject.
      const [rows] = await withSpan('mysql.reservationLock', {
        kind: SpanKind.CLIENT,
        annotations: { operation: 'cancellation_lock' },
        errorType: 'mysql_reservation_lock_error',
      }, () => conn.query(
        `SELECT r.*,
                g.email AS guest_email,
                CONCAT(g.first_name, ' ', g.last_name) AS guest_name,
                h.name AS hotel_name,
                rt.name AS room_type_name
           FROM reservation r
           JOIN guest g ON g.guest_id = r.guest_id
           JOIN hotel h ON h.hotel_id = r.hotel_id
           JOIN room_type rt ON rt.room_type_id = r.room_type_id
          WHERE r.reservation_id = ? AND g.cognito_sub = ?
          LIMIT 1
          FOR UPDATE`,
        [reservationId, cognitoSub]
      ));
    if (!rows.length) throw { status: 404, message: 'Reservation not found' };

    const reservation = rows[0];
    if (reservation.status === 'CANCELLED') {
      throw { status: 409, message: 'Reservation is already cancelled' };
    }

    const ageInDays = (Date.now() - new Date(reservation.created_at).getTime()) / 86400000;
    if (ageInDays > 3) {
      throw { status: 403, message: 'Cancellation window has closed (3-day limit exceeded)' };
    }

      await withSpan('mysql.cancelReservation', {
        kind: SpanKind.CLIENT,
        annotations: { operation: 'reservation_cancel_update' },
        errorType: 'mysql_reservation_cancel_error',
      }, () => conn.query(
        `UPDATE reservation
            SET status     = 'CANCELLED',
                updated_at = NOW()
          WHERE reservation_id = ? AND status = 'CONFIRMED'`,
        [reservationId]
      ));
      await withSpan('mysql.updateInventory', {
        kind: SpanKind.CLIENT,
        annotations: { operation: 'inventory_release' },
        errorType: 'mysql_inventory_update_error',
      }, () => conn.query(
        `UPDATE room_type_inventory
            SET total_reserved = GREATEST(total_reserved - ?, 0)
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
      ));

      await withSpan('mysql.commit', {
        kind: SpanKind.CLIENT,
        annotations: { operation: 'cancellation_commit' },
        errorType: 'mysql_commit_error',
      }, () => conn.commit());

    logger.info('Reservation cancelled', { reservationId, roomCount: reservation.room_count, guestId: reservation.guest_id });

      return {
        ...reservation,
        status: 'CANCELLED',
        updated_at: new Date(),
      };
    } catch (err) {
      await withSpan('mysql.rollback', {
        kind: SpanKind.CLIENT,
        annotations: { operation: 'cancellation_rollback' },
        errorType: 'mysql_rollback_error',
      }, () => conn.rollback());
      throw err;
    } finally {
      conn.release();
    }
  });
}

module.exports = { createReservation, cancelReservation };
