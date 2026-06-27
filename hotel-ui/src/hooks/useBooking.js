import { useState, useRef } from 'react';
import { apiPost } from '../api/client';

/**
 * Generate a UUID v4 using the browser's built-in crypto API.
 * @returns {string} A valid UUID v4 string
 */
function generateUUID() {
  return crypto.randomUUID();
}

/**
 * Custom hook that manages the booking submission lifecycle.
 *
 * - Generates an idempotency key per submission session (persisted to sessionStorage)
 * - Reuses the same key on retries within the same session
 * - Generates a new key only when reset() is called
 * - Calls POST /v1/reservations with the Idempotency-Key header
 * - Persists reservation_id to sessionStorage on success
 *
 * @returns {{ loading: boolean, error: Error|null, reservation: object|null, submit: Function, reset: Function }}
 */
export function useBooking() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reservation, setReservation] = useState(null);

  // Lazily initialise the submission session on first hook usage.
  // useRef ensures the key persists across re-renders without triggering them.
  const sessionIdRef = useRef(null);
  const idempotencyKeyRef = useRef(null);

  function ensureIdempotencyKey() {
    if (idempotencyKeyRef.current === null) {
      const sessionId = generateUUID();
      const key = generateUUID();
      sessionIdRef.current = sessionId;
      idempotencyKeyRef.current = key;
      sessionStorage.setItem(`rh_idempotency_${sessionId}`, key);
    }
    return idempotencyKeyRef.current;
  }

  /**
   * Submit a reservation request. Uses the same idempotency key if called
   * multiple times without a reset (retry semantics).
   *
   * @param {object} data - Reservation payload (hotel_id, room_type_id, guest_id, start_date, end_date, room_count)
   * @returns {Promise<object>} The reservation response from the API
   */
  async function submit(data) {
    const idempotencyKey = ensureIdempotencyKey();
    setLoading(true);
    setError(null);
    try {
      const response = await apiPost('/v1/reservations', data, {
        'Idempotency-Key': idempotencyKey,
      });
      setReservation(response);
      sessionStorage.setItem('rh_last_reservation', String(response.reservation_id));
      return response;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }

  /**
   * Reset the booking state and generate a fresh idempotency key for a new
   * submission session. Call this when starting a new booking form session.
   */
  function reset() {
    setReservation(null);
    setError(null);
    // Generate a new submission session with a fresh idempotency key
    const sessionId = generateUUID();
    const key = generateUUID();
    sessionIdRef.current = sessionId;
    idempotencyKeyRef.current = key;
    sessionStorage.setItem(`rh_idempotency_${sessionId}`, key);
  }

  return { loading, error, reservation, submit, reset };
}
