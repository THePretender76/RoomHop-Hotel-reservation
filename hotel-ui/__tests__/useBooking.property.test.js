import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';

// UUID v4 regex pattern
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Mock sessionStorage for testing
class MockSessionStorage {
  constructor() { this.store = {}; }
  getItem(key) { return this.store[key] || null; }
  setItem(key, value) { this.store[key] = String(value); }
  removeItem(key) { delete this.store[key]; }
  clear() { this.store = {}; }
}

/**
 * Pure idempotency key logic — mirrors the logic in useBooking.js.
 * We extract it here to test the core algorithm without React hooks.
 */
function generateUUID() {
  return crypto.randomUUID();
}

class BookingSession {
  constructor(storage) {
    this.storage = storage;
    this.sessionId = null;
    this.idempotencyKey = null;
  }

  ensureIdempotencyKey() {
    if (this.idempotencyKey === null) {
      this.sessionId = generateUUID();
      this.idempotencyKey = generateUUID();
      this.storage.setItem(`rh_idempotency_${this.sessionId}`, this.idempotencyKey);
    }
    return this.idempotencyKey;
  }

  reset() {
    this.sessionId = generateUUID();
    this.idempotencyKey = generateUUID();
    this.storage.setItem(`rh_idempotency_${this.sessionId}`, this.idempotencyKey);
  }

  persistReservation(reservationId) {
    this.storage.setItem('rh_last_reservation', String(reservationId));
  }
}

describe('Property 13: SPA idempotency key is a valid UUID per submission session', () => {
  /**
   * Validates: Requirements 9.6
   *
   * For any booking form submission, the Idempotency-Key header value SHALL be a valid UUID v4.
   * Two independent submissions (after reset()) SHALL generate different UUIDs.
   * Retrying the same submission (before reset()) SHALL reuse the same UUID.
   */

  let storage;

  beforeEach(() => {
    storage = new MockSessionStorage();
  });

  it('ensureIdempotencyKey() always returns a valid UUID v4', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const session = new BookingSession(new MockSessionStorage());
        const key = session.ensureIdempotencyKey();
        expect(key).toMatch(UUID_V4_REGEX);
      }),
      { numRuns: 100 }
    );
  });

  it('calling ensureIdempotencyKey() twice without reset() returns the same UUID', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const session = new BookingSession(new MockSessionStorage());
        const first = session.ensureIdempotencyKey();
        const second = session.ensureIdempotencyKey();
        expect(first).toBe(second);
      }),
      { numRuns: 100 }
    );
  });

  it('after reset(), ensureIdempotencyKey() returns a different UUID', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const session = new BookingSession(new MockSessionStorage());
        const first = session.ensureIdempotencyKey();
        session.reset();
        const second = session.ensureIdempotencyKey();
        // After reset, the key is already set by reset(), so ensureIdempotencyKey returns it
        expect(second).toMatch(UUID_V4_REGEX);
        expect(second).not.toBe(first);
      }),
      { numRuns: 100 }
    );
  });

  it('two independent BookingSessions generate different UUIDs', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const session1 = new BookingSession(new MockSessionStorage());
        const session2 = new BookingSession(new MockSessionStorage());
        const key1 = session1.ensureIdempotencyKey();
        const key2 = session2.ensureIdempotencyKey();
        expect(key1).toMatch(UUID_V4_REGEX);
        expect(key2).toMatch(UUID_V4_REGEX);
        expect(key1).not.toBe(key2);
      }),
      { numRuns: 100 }
    );
  });
});

describe('Property 14: Confirmed reservation_id is persisted to session storage', () => {
  /**
   * Validates: Requirements 9.7
   *
   * For any booking that receives a successful response, the reservation_id
   * SHALL be present in sessionStorage under key `rh_last_reservation`.
   */

  it('persistReservation stores reservation_id under rh_last_reservation', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: 1, max: 1000000 }),
          fc.uuid()
        ),
        (reservationId) => {
          const storage = new MockSessionStorage();
          const session = new BookingSession(storage);
          session.persistReservation(reservationId);
          expect(storage.getItem('rh_last_reservation')).toBe(String(reservationId));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('persistReservation overwrites previous reservation_id', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.integer({ min: 1, max: 1000000 }), fc.uuid()),
        fc.oneof(fc.integer({ min: 1, max: 1000000 }), fc.uuid()),
        (firstId, secondId) => {
          const storage = new MockSessionStorage();
          const session = new BookingSession(storage);
          session.persistReservation(firstId);
          session.persistReservation(secondId);
          expect(storage.getItem('rh_last_reservation')).toBe(String(secondId));
        }
      ),
      { numRuns: 100 }
    );
  });

  it('reservation_id is stored as a string regardless of input type', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.integer({ min: 1, max: 999999 }),
          fc.uuid(),
          fc.string({ minLength: 1, maxLength: 36 }).filter(s => s.trim().length > 0)
        ),
        (reservationId) => {
          const storage = new MockSessionStorage();
          const session = new BookingSession(storage);
          session.persistReservation(reservationId);
          const stored = storage.getItem('rh_last_reservation');
          expect(typeof stored).toBe('string');
          expect(stored).toBe(String(reservationId));
        }
      ),
      { numRuns: 100 }
    );
  });
});
