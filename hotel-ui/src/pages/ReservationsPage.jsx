import { useState } from 'react';
import { apiGet, apiDelete } from '../api/client';
import styles from './ReservationsPage.module.css';

export default function ReservationsPage() {
  const [lookupType, setLookupType] = useState('guest'); // 'reservation' or 'guest'
  const [lookupValue, setLookupValue] = useState('');
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(null); // reservation id to confirm
  const [searched, setSearched] = useState(false);

  async function handleLookup(e) {
    e.preventDefault();
    if (!lookupValue.trim()) return;

    setLoading(true);
    setError('');
    setSuccessMsg('');
    setReservations([]);
    setSearched(true);

    try {
      if (lookupType === 'reservation') {
        const data = await apiGet(`/v1/reservations/${lookupValue}`);
        setReservations(data.reservation ? [data.reservation] : []);
      } else {
        const data = await apiGet('/v1/reservations', { guest_id: lookupValue });
        setReservations(data.reservations || []);
      }
    } catch (err) {
      if (err.status === 404) {
        setError('No reservations found.');
      } else {
        setError(err.message || 'Something went wrong.');
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel(id) {
    setError('');
    setSuccessMsg('');

    try {
      await apiDelete(`/v1/reservations/${id}`);
      setReservations((prev) =>
        prev.map((r) =>
          r.reservation_id === id ? { ...r, status: 'CANCELLED' } : r
        )
      );
      setSuccessMsg(`Reservation #${id} has been cancelled.`);
    } catch (err) {
      if (err.status === 403) {
        setError('Cancellation window has closed (more than 3 days since booking).');
      } else if (err.status === 404) {
        setError('Reservation not found.');
      } else if (err.status === 409) {
        setError('Reservation is already cancelled.');
      } else {
        setError(err.message || 'Failed to cancel reservation.');
      }
    } finally {
      setConfirmCancel(null);
    }
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-GB', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <h1 className={styles.pageTitle}>My Reservations</h1>
        <p className={styles.pageSubtitle}>
          Look up your reservations by reservation ID or guest ID.
        </p>

        {/* Lookup Form */}
        <div className={styles.lookupCard}>
          <form onSubmit={handleLookup} className={styles.lookupForm}>
            <div className={styles.lookupOptions}>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="lookupType"
                  value="guest"
                  checked={lookupType === 'guest'}
                  onChange={() => { setLookupType('guest'); setLookupValue(''); }}
                />
                <span>Guest ID</span>
              </label>
              <label className={styles.radioLabel}>
                <input
                  type="radio"
                  name="lookupType"
                  value="reservation"
                  checked={lookupType === 'reservation'}
                  onChange={() => { setLookupType('reservation'); setLookupValue(''); }}
                />
                <span>Reservation ID</span>
              </label>
            </div>

            <div className={styles.lookupInputRow}>
              <input
                type="number"
                min="1"
                className={styles.lookupInput}
                placeholder={lookupType === 'guest' ? 'Enter your Guest ID' : 'Enter Reservation ID'}
                value={lookupValue}
                onChange={(e) => setLookupValue(e.target.value)}
                required
              />
              <button type="submit" className={styles.lookupBtn} disabled={loading}>
                {loading ? 'Searching…' : 'Look up'}
              </button>
            </div>
          </form>
        </div>

        {/* Messages */}
        {successMsg && <div className={styles.successMsg}>{successMsg}</div>}
        {error && <div className={styles.errorMsg}>{error}</div>}

        {/* Results */}
        {searched && !loading && reservations.length === 0 && !error && (
          <p className={styles.noResults}>No reservations found.</p>
        )}

        {reservations.length > 0 && (
          <div className={styles.resultsList}>
            {reservations.map((r) => (
              <div key={r.reservation_id} className={styles.reservationCard}>
                <div className={styles.cardHeader}>
                  <span className={styles.reservationId}>Reservation #{r.reservation_id}</span>
                  <span
                    className={`${styles.statusBadge} ${
                      r.status === 'CONFIRMED'
                        ? styles.statusConfirmed
                        : styles.statusCancelled
                    }`}
                  >
                    {r.status}
                  </span>
                </div>

                <div className={styles.cardBody}>
                  <div className={styles.cardRow}>
                    <span className={styles.cardLabel}>Hotel</span>
                    <span className={styles.cardValue}>{r.hotel_name || '—'}</span>
                  </div>
                  <div className={styles.cardRow}>
                    <span className={styles.cardLabel}>Room Type</span>
                    <span className={styles.cardValue}>{r.room_type_name || '—'}</span>
                  </div>
                  <div className={styles.cardRow}>
                    <span className={styles.cardLabel}>Check-in</span>
                    <span className={styles.cardValue}>{formatDate(r.start_date)}</span>
                  </div>
                  <div className={styles.cardRow}>
                    <span className={styles.cardLabel}>Check-out</span>
                    <span className={styles.cardValue}>{formatDate(r.end_date)}</span>
                  </div>
                  <div className={styles.cardRow}>
                    <span className={styles.cardLabel}>Amount</span>
                    <span className={styles.cardValue}>€{Number(r.amount).toFixed(2)}</span>
                  </div>
                  <div className={styles.cardRow}>
                    <span className={styles.cardLabel}>Created</span>
                    <span className={styles.cardValue}>{formatDate(r.created_at)}</span>
                  </div>
                </div>

                {r.status === 'CONFIRMED' && (
                  <div className={styles.cardFooter}>
                    {confirmCancel === r.reservation_id ? (
                      <div className={styles.confirmDialog}>
                        <p>Are you sure you want to cancel reservation #{r.reservation_id}?</p>
                        <div className={styles.confirmActions}>
                          <button
                            className={styles.confirmYes}
                            onClick={() => handleCancel(r.reservation_id)}
                          >
                            Yes, cancel
                          </button>
                          <button
                            className={styles.confirmNo}
                            onClick={() => setConfirmCancel(null)}
                          >
                            No, keep it
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        className={styles.cancelBtn}
                        onClick={() => setConfirmCancel(r.reservation_id)}
                      >
                        Cancel Reservation
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
