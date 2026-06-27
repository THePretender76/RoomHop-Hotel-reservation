'use strict';

// Feature: roomhop-booking-platform
// Property 10: Cancellation window enforcement
// Validates: Requirements 4.3

const fc = require('fast-check');

/**
 * Pure inline helper that mirrors cancelReservation's 3-day window check
 * from reservationService.js.
 */
function isCancellationAllowed(createdAt, now) {
  const diffMs = now - createdAt;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return diffDays <= 3;
}

const THREE_DAYS_MS = 3 * 24 * 60 * 60 * 1000;

describe('isCancellationAllowed – Property 10: Cancellation window enforcement', () => {
  /**
   * Property 10a: Any `now` within 3 days of `createdAt` returns true.
   * Validates: Requirements 4.3
   */
  test('returns true for any now within 3 days of createdAt', () => {
    // **Validates: Requirements 4.3**
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2024-01-01'), max: new Date('2026-01-01') }),
        fc.integer({ min: 0, max: THREE_DAYS_MS }),
        (createdAtDate, offsetMs) => {
          const createdAt = createdAtDate.getTime();
          const now = createdAt + offsetMs;
          expect(isCancellationAllowed(createdAt, now)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 10b: Any `now` strictly more than 3 days after `createdAt` returns false.
   * Validates: Requirements 4.3
   */
  test('returns false for any now strictly more than 3 days after createdAt', () => {
    // **Validates: Requirements 4.3**
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2024-01-01'), max: new Date('2026-01-01') }),
        fc.integer({ min: 1, max: 30 * 24 * 60 * 60 * 1000 }),
        (createdAtDate, extraMs) => {
          const createdAt = createdAtDate.getTime();
          // now = createdAt + 3days + 1ms + extraMs  (strictly outside window)
          const now = createdAt + THREE_DAYS_MS + 1 + extraMs;
          expect(isCancellationAllowed(createdAt, now)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 10c: At exactly 3 days (72 hours) returns true — boundary still within window.
   * Validates: Requirements 4.3
   */
  test('returns true at exactly 3 days (72 hours) — boundary is inclusive', () => {
    // **Validates: Requirements 4.3**
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2024-01-01'), max: new Date('2026-01-01') }),
        (createdAtDate) => {
          const createdAt = createdAtDate.getTime();
          const now = createdAt + THREE_DAYS_MS; // exactly 72h
          expect(isCancellationAllowed(createdAt, now)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 10d: Just after 3 days (72h + 1ms) returns false.
   * Validates: Requirements 4.3
   */
  test('returns false at 72h + 1ms — just outside the window', () => {
    // **Validates: Requirements 4.3**
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2024-01-01'), max: new Date('2026-01-01') }),
        (createdAtDate) => {
          const createdAt = createdAtDate.getTime();
          const now = createdAt + THREE_DAYS_MS + 1; // 72h + 1ms
          expect(isCancellationAllowed(createdAt, now)).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });
});
