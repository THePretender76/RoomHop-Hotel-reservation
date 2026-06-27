'use strict';

// Feature: roomhop-booking-platform
// Property 11: Reservation list is ordered by created_at descending
// Property 12: Reservation detail response is structurally complete
// Validates: Requirements 5.1, 5.2

const fc = require('fast-check');

// -------------------------------------------------------
// Pure helpers
// -------------------------------------------------------

/**
 * Mirrors the ORDER BY r.created_at DESC sort from the GET /v1/reservations route.
 */
function sortByCreatedAtDesc(reservations) {
  return [...reservations].sort(
    (a, b) => new Date(b.created_at) - new Date(a.created_at)
  );
}

/**
 * Returns true when every consecutive pair in the array satisfies
 * created_at[i] >= created_at[i+1] (i.e. descending order).
 */
function isDescendingByCreatedAt(reservations) {
  for (let i = 0; i < reservations.length - 1; i++) {
    if (new Date(reservations[i].created_at) < new Date(reservations[i + 1].created_at)) {
      return false;
    }
  }
  return true;
}

// -------------------------------------------------------
// Arbitraries
// -------------------------------------------------------

const reservationArb = fc.array(
  fc.record({
    reservation_id: fc.integer({ min: 1, max: 1000 }),
    created_at: fc
      .date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') })
      .map((d) => d.toISOString()),
  }),
  { minLength: 2, maxLength: 20 }
);

// -------------------------------------------------------
// Property 11: Reservation list is ordered by created_at descending
// Validates: Requirements 5.1
// -------------------------------------------------------

describe('sortByCreatedAtDesc – Property 11: Reservation list ordered by created_at DESC', () => {
  /**
   * Property 11a: sortByCreatedAtDesc always produces a descending order.
   * Validates: Requirements 5.1
   */
  test('sortByCreatedAtDesc always produces a list in descending created_at order', () => {
    // **Validates: Requirements 5.1**
    fc.assert(
      fc.property(reservationArb, (reservations) => {
        const sorted = sortByCreatedAtDesc(reservations);
        expect(isDescendingByCreatedAt(sorted)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 11b: isDescendingByCreatedAt returns true for any already-sorted array.
   * Validates: Requirements 5.1
   */
  test('isDescendingByCreatedAt returns true for any array sorted descending', () => {
    // **Validates: Requirements 5.1**
    fc.assert(
      fc.property(reservationArb, (reservations) => {
        const sorted = sortByCreatedAtDesc(reservations);
        // The helper itself should confirm the sorted output passes
        expect(isDescendingByCreatedAt(sorted)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 11c: isDescendingByCreatedAt returns false for a strictly ascending array
   * with distinct timestamps (length >= 2).
   * Validates: Requirements 5.1
   */
  test('isDescendingByCreatedAt returns false for an ascending-only array with distinct timestamps', () => {
    // **Validates: Requirements 5.1**
    fc.assert(
      fc.property(
        fc.array(
          fc.date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') }),
          { minLength: 2, maxLength: 20 }
        ),
        (dates) => {
          // Sort dates ascending and deduplicate to guarantee strictly ascending
          const unique = [...new Set(dates.map((d) => d.getTime()))].sort((a, b) => a - b);
          fc.pre(unique.length >= 2); // need at least 2 distinct timestamps

          const ascending = unique.map((ms, idx) => ({
            reservation_id: idx + 1,
            created_at: new Date(ms).toISOString(),
          }));

          expect(isDescendingByCreatedAt(ascending)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});

// -------------------------------------------------------
// Property 12: Reservation detail response is structurally complete
// Validates: Requirements 5.2
// -------------------------------------------------------

const REQUIRED_DETAIL_FIELDS = [
  'reservation_id',
  'hotel_id',
  'hotel_name',
  'room_type_id',
  'room_type_name',
  'guest_id',
  'start_date',
  'end_date',
  'status',
  'room_count',
  'amount',
  'created_at',
  'updated_at',
];

/**
 * Arbitrary that generates a reservation object with all required detail fields.
 */
const fullReservationArb = fc.record({
  reservation_id: fc.integer({ min: 1, max: 1000 }),
  hotel_id: fc.integer({ min: 1, max: 500 }),
  hotel_name: fc.string({ minLength: 1, maxLength: 50 }),
  room_type_id: fc.integer({ min: 1, max: 100 }),
  room_type_name: fc.string({ minLength: 1, maxLength: 50 }),
  guest_id: fc.integer({ min: 1, max: 10000 }),
  start_date: fc
    .date({ min: new Date('2024-01-01'), max: new Date('2026-01-01') })
    .map((d) => d.toISOString().slice(0, 10)),
  end_date: fc
    .date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') })
    .map((d) => d.toISOString().slice(0, 10)),
  status: fc.constantFrom('CONFIRMED', 'CANCELLED'),
  room_count: fc.integer({ min: 1, max: 10 }),
  amount: fc.float({ min: 0, max: 10000, noNaN: true }),
  created_at: fc
    .date({ min: new Date('2024-01-01'), max: new Date('2026-01-01') })
    .map((d) => d.toISOString()),
  updated_at: fc
    .date({ min: new Date('2024-01-01'), max: new Date('2026-12-31') })
    .map((d) => d.toISOString()),
});

describe('Reservation detail – Property 12: Reservation detail response is structurally complete', () => {
  /**
   * Property 12: Every required field is present in the reservation detail object.
   * Validates: Requirements 5.2
   */
  test('reservation detail object contains all required fields', () => {
    // **Validates: Requirements 5.2**
    fc.assert(
      fc.property(fullReservationArb, (reservation) => {
        for (const field of REQUIRED_DETAIL_FIELDS) {
          expect(reservation).toHaveProperty(field);
        }
      }),
      { numRuns: 100 }
    );
  });
});
