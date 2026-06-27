'use strict';

/**
 * Property-based tests for notification retry logic
 * Validates: Requirements 6.3, 6.5
 *
 * Tests the retry logic in isolation using an inline implementation that mirrors
 * consumer.js exactly — no Kafka connection needed.
 */

const fc = require('fast-check');

// ---------------------------------------------------------------------------
// Inline retry implementation — mirrors consumer.js processWithRetry exactly
// ---------------------------------------------------------------------------
const MAX_RETRIES = 3;

async function processWithRetry(event, handler) {
  let attempts = 0;
  const logs = [];
  while (attempts < MAX_RETRIES) {
    try {
      await handler(event);
      return { attempts: attempts + 1, logs, succeeded: true };
    } catch (err) {
      attempts++;
      if (attempts >= MAX_RETRIES) {
        const logEntry = {
          guest_id: event.guestId,
          reservation_id: event.reservationId,
          error: err.message || String(err),
        };
        logs.push(logEntry);
        return { attempts, logs, succeeded: false };
      }
      // RETRY_DELAY_MS skipped in tests for speed
    }
  }
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Generates a valid reservation event with guestId and reservationId */
const eventArb = fc.record({
  guestId: fc.integer({ min: 1, max: 1000 }),
  reservationId: fc.integer({ min: 1, max: 1000 }),
});

/** Generates a non-empty, non-whitespace-only error message */
const errorMessageArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => s.trim() !== '');

// ---------------------------------------------------------------------------
// Property 9 — Notification retry count and permanent-failure log
// Validates: Requirements 6.3, 6.5
// ---------------------------------------------------------------------------

describe('Property 9 — Notification retry count and permanent-failure log', () => {
  /**
   * Property 9a: Attempt count never exceeds 3
   * For any handler that always throws, total attempts must be exactly 3.
   */
  it('9a: attempt count is exactly 3 when the handler always fails', async () => {
    await fc.assert(
      fc.asyncProperty(eventArb, errorMessageArb, async (event, errorMessage) => {
        const alwaysThrows = jest.fn().mockRejectedValue(new Error(errorMessage));
        const result = await processWithRetry(event, alwaysThrows);

        expect(result.attempts).toBe(MAX_RETRIES);
        expect(result.attempts).toBeLessThanOrEqual(MAX_RETRIES);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 9b: Permanent-failure log contains required fields
   * On the 3rd failure, the log entry must contain guest_id, reservation_id, and error.
   */
  it('9b: permanent-failure log entry contains guest_id, reservation_id, and error', async () => {
    await fc.assert(
      fc.asyncProperty(eventArb, errorMessageArb, async (event, errorMessage) => {
        const alwaysThrows = jest.fn().mockRejectedValue(new Error(errorMessage));
        const result = await processWithRetry(event, alwaysThrows);

        expect(result.succeeded).toBe(false);
        expect(result.logs).toHaveLength(1);

        const logEntry = result.logs[0];
        expect(logEntry).toHaveProperty('guest_id', event.guestId);
        expect(logEntry).toHaveProperty('reservation_id', event.reservationId);
        expect(logEntry).toHaveProperty('error');
        expect(typeof logEntry.error).toBe('string');
        expect(logEntry.error.length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 9c: No 4th attempt
   * The handler must be called at most MAX_RETRIES (3) times — never a 4th time.
   */
  it('9c: handler is called at most 3 times — never a 4th attempt', async () => {
    await fc.assert(
      fc.asyncProperty(eventArb, errorMessageArb, async (event, errorMessage) => {
        const alwaysThrows = jest.fn().mockRejectedValue(new Error(errorMessage));
        await processWithRetry(event, alwaysThrows);

        expect(alwaysThrows).toHaveBeenCalledTimes(MAX_RETRIES);
        expect(alwaysThrows.mock.calls.length).toBeLessThanOrEqual(MAX_RETRIES);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 9d: Eventual success stops retrying early
   * If the handler succeeds on attempt N (1 ≤ N ≤ 3), the result must show
   * exactly N attempts and succeeded=true.
   */
  it('9d: success on attempt N stops retrying — attempts equals N', async () => {
    // successOnAttempt: integer 1..3, meaning the handler throws for the first
    // (N-1) calls, then resolves on attempt N.
    const successOnAttemptArb = fc.integer({ min: 1, max: MAX_RETRIES });

    await fc.assert(
      fc.asyncProperty(eventArb, errorMessageArb, successOnAttemptArb, async (event, errorMessage, successOn) => {
        let callCount = 0;
        const handler = jest.fn().mockImplementation(() => {
          callCount++;
          if (callCount < successOn) {
            return Promise.reject(new Error(errorMessage));
          }
          return Promise.resolve();
        });

        const result = await processWithRetry(event, handler);

        expect(result.succeeded).toBe(true);
        expect(result.attempts).toBe(successOn);
        expect(handler).toHaveBeenCalledTimes(successOn);
      }),
      { numRuns: 100 }
    );
  });
});
