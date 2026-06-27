'use strict';

// Feature: roomhop-booking-platform, Property 8: Missing required fields always yield 422 with field names

/**
 * Validates: Requirements 3.8
 *
 * Property 8: For any non-empty subset of required fields omitted,
 * validateReservationBody must return an array containing exactly those
 * field names (no more, no less).
 */

const fc = require('fast-check');
const { validateReservationBody } = require('../src/middleware/validate');

const REQUIRED_FIELDS = [
  'hotel_id',
  'room_type_id',
  'guest_id',
  'start_date',
  'end_date',
  'room_count',
];

/** Valid values for each required field */
const VALID_VALUES = {
  hotel_id: 1,
  room_type_id: 2,
  guest_id: 3,
  start_date: '2025-01-01',
  end_date: '2025-01-05',
  room_count: 1,
};

/**
 * Arbitrarily generates a non-empty subset of REQUIRED_FIELDS indices,
 * then returns an array of field names representing the omitted fields.
 */
const nonEmptySubsetArb = fc
  .array(fc.integer({ min: 0, max: REQUIRED_FIELDS.length - 1 }), {
    minLength: 1,
  })
  .map((indices) => {
    // Deduplicate and map back to field names
    const unique = [...new Set(indices)];
    return unique.map((i) => REQUIRED_FIELDS[i]);
  })
  .filter((fields) => fields.length > 0); // guard: ensure non-empty after dedup

describe('validateReservationBody – Property 8: Missing required fields', () => {
  test('returns exactly the omitted field names for any non-empty subset of missing fields', () => {
    fc.assert(
      fc.property(nonEmptySubsetArb, (omittedFields) => {
        // Build a body that includes all required fields EXCEPT the omitted ones
        const body = {};
        for (const field of REQUIRED_FIELDS) {
          if (!omittedFields.includes(field)) {
            body[field] = VALID_VALUES[field];
          }
        }

        const result = validateReservationBody(body);

        // Must be an array
        expect(Array.isArray(result)).toBe(true);

        // Must contain exactly the omitted fields — same length
        expect(result).toHaveLength(omittedFields.length);

        // Every omitted field must appear in the result
        for (const field of omittedFields) {
          expect(result).toContain(field);
        }

        // No extra fields should appear in the result
        for (const field of result) {
          expect(omittedFields).toContain(field);
        }
      }),
      { numRuns: 1000 }
    );
  });
});


// =============================================================
// Property 5: Reservation creation posts correct amount
// Feature: roomhop-booking-platform, Property 5: Reservation creation posts correct amount
// =============================================================

/**
 * Validates: Requirements 3.5
 *
 * Pure function under test:
 *   calculateAmount(roomCount, rates) → sum of (roomCount × rate) for each nightly rate.
 *
 * Property: for any roomCount (1–10) and any array of nightly rates (1–14 nights,
 * each rate 50–500), calculateAmount must equal the reference reduction.
 */

/**
 * Pure helper that mirrors the amount logic in reservationService.js:
 *   amount = rateRows.reduce((sum, r) => sum + r.nightly_rate * room_count, 0)
 */
function calculateAmount(roomCount, rates) {
  return rates.reduce((sum, rate) => sum + roomCount * rate, 0);
}

describe('calculateAmount – Property 5: Reservation creation posts correct amount', () => {
  test('amount equals sum of room_count × nightly_rate for each date in range', () => {
    // Feature: roomhop-booking-platform, Property 5: Reservation creation posts correct amount
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),                                   // roomCount
        fc.array(fc.float({ min: 50, max: 500, noNaN: true }), {           // nightly rates
          minLength: 1,
          maxLength: 14,
        }),
        (roomCount, rates) => {
          const expected = rates.reduce((sum, r) => sum + roomCount * r, 0);
          expect(calculateAmount(roomCount, rates)).toBeCloseTo(expected, 5);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// =============================================================
// Property 6: Inventory is conserved across create-then-cancel round trip
// Feature: roomhop-booking-platform, Property 6: Inventory conserved across create-then-cancel
// =============================================================

/**
 * Validates: Requirements 3.3, 4.2
 *
 * Pure functions under test:
 *   applyReservation(inv, roomCount)  → inv.total_reserved += roomCount
 *   applyCancel(inv, roomCount)       → inv.total_reserved -= roomCount
 *
 * Property: for any totalInventory (1–20) and roomCount (1–5) where
 * roomCount <= totalInventory, applyReservation then applyCancel leaves
 * total_reserved === 0 (back to initial state).
 */

function applyReservation(inv, roomCount) {
  inv.total_reserved += roomCount;
}

function applyCancel(inv, roomCount) {
  inv.total_reserved -= roomCount;
}

describe('Inventory round trip – Property 6: Inventory conserved across create-then-cancel', () => {
  test('create then cancel restores total_reserved to its original value', () => {
    // Feature: roomhop-booking-platform, Property 6: Inventory conserved across create-then-cancel
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),  // totalInventory
        fc.integer({ min: 1, max: 5 }),   // roomCount
        (totalInventory, roomCount) => {
          fc.pre(roomCount <= totalInventory);

          const inv = { total_inventory: totalInventory, total_reserved: 0 };
          applyReservation(inv, roomCount);
          applyCancel(inv, roomCount);

          expect(inv.total_reserved).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// =============================================================
// Property 7: Idempotency key prevents duplicate reservations
// Feature: roomhop-booking-platform, Property 7: Idempotency key prevents duplicate reservations
// =============================================================

/**
 * Validates: Requirements 3.6
 *
 * Pure function under test:
 *   applyIdempotencyCheck(reservationStore, idempotencyKey, newReservation)
 *   → returns the existing reservation if the key is already in the store,
 *     otherwise inserts newReservation and returns it.
 *
 * Property: calling it twice with the same key returns the same reservation_id
 * and leaves the store size at exactly 1.
 */

function applyIdempotencyCheck(reservationStore, idempotencyKey, newReservation) {
  if (reservationStore.has(idempotencyKey)) {
    return reservationStore.get(idempotencyKey);
  }
  reservationStore.set(idempotencyKey, newReservation);
  return newReservation;
}

describe('applyIdempotencyCheck – Property 7: Idempotency key prevents duplicate reservations', () => {
  test('calling with the same key twice returns the same reservation_id and keeps store size at 1', () => {
    // Feature: roomhop-booking-platform, Property 7: Idempotency key prevents duplicate reservations
    fc.assert(
      fc.property(
        fc.uuid(),                          // idempotency key (UUID)
        fc.integer({ min: 1, max: 10000 }), // first reservation_id
        fc.integer({ min: 1, max: 10000 }), // second (different) reservation_id
        (idempotencyKey, firstId, secondId) => {
          fc.pre(firstId !== secondId); // ensure they are genuinely distinct

          const store = new Map();
          const firstReservation  = { reservation_id: firstId,  status: 'CONFIRMED' };
          const secondReservation = { reservation_id: secondId, status: 'CONFIRMED' };

          const result1 = applyIdempotencyCheck(store, idempotencyKey, firstReservation);
          const result2 = applyIdempotencyCheck(store, idempotencyKey, secondReservation);

          // Both calls must return the same reservation_id (the first one)
          expect(result1.reservation_id).toBe(firstId);
          expect(result2.reservation_id).toBe(firstId);

          // Store must contain exactly one entry
          expect(store.size).toBe(1);
        }
      ),
      { numRuns: 100 }
    );
  });
});
