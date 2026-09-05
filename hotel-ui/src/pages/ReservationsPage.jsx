import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { apiGet, apiDelete } from '../api/client';
import { useAuth } from '../auth/useAuth';
import { isAuthEnabled } from '../auth/amplifyConfig';
import styles from './ReservationsPage.module.css';

export default function ReservationsPage() {
  const { user } = useAuth();
  const authEnabled = isAuthEnabled();
  const userEmail = authEnabled && user?.attributes?.email ? user.attributes.email : null;

  const [guestId, setGuestId] = useState('');
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [confirmCancel, setConfirmCancel] = useState(null);
  const [searched, setSearched] = useState(false);
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'upcoming', 'past', 'cancelled'

  // Auto-fetch reservations when user is authenticated
  useEffect(() => {
    if (userEmail) {
      // The API derives reservation ownership from the verified JWT subject.
      // Do not send an email or guest ID as an authorization selector.
      fetchReservations({});
    }
  }, [userEmail]);

  async function fetchReservations(params) {
    setLoading(true);
    setError('');
    setSuccessMsg('');
    setReservations([]);
    setSearched(true);
    try {
      const data = await apiGet('/v1/reservations', params);
      setReservations(data.reservations || []);
    } catch (err) {
      if (err.status === 404) setError('No reservations found.');
      else setError(err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  }

  async function handleLookup(e) {
    e.preventDefault();
    if (!guestId.trim()) return;
    fetchReservations({ guest_id: guestId });
  }

  async function handleCancel(id) {
    setError('');
    setSuccessMsg('');
    try {
      await apiDelete(`/v1/reservations/${id}`);
      setReservations((prev) =>
        prev.map((r) => r.reservation_id === id ? { ...r, status: 'CANCELLED' } : r)
      );
      setSuccessMsg(`Reservation #${id} has been cancelled successfully.`);
    } catch (err) {
      if (err.status === 403) setError('Cancellation window has closed (more than 3 days since booking).');
      else if (err.status === 404) setError('Reservation not found.');
      else if (err.status === 409) setError('Reservation is already cancelled.');
      else setError(err.message || 'Failed to cancel reservation.');
    } finally {
      setConfirmCancel(null);
    }
  }

  function formatDate(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    const day = d.getDate();
    const month = d.toLocaleDateString('en-GB', { month: 'short' });
    const year = d.getFullYear();
    return `${day} ${month} ${year}`;
  }

  // Filter by tab
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const filtered = reservations.filter((r) => {
    if (activeTab === 'upcoming') return r.status === 'CONFIRMED' && new Date(r.start_date) >= today;
    if (activeTab === 'past') return r.status === 'CONFIRMED' && new Date(r.end_date) < today;
    if (activeTab === 'cancelled') return r.status === 'CANCELLED';
    return true; // 'all'
  });

  // Stats
  const upcomingCount = reservations.filter(r => r.status === 'CONFIRMED' && new Date(r.start_date) >= today).length;
  const pastCount = reservations.filter(r => r.status === 'CONFIRMED' && new Date(r.end_date) < today).length;
  const cancelledCount = reservations.filter(r => r.status === 'CANCELLED').length;

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* Breadcrumb */}
        <nav className={styles.breadcrumb}>
          <Link to="/">Home</Link> <span>›</span> <span>Your Trips</span>
        </nav>

        {/* Header */}
        <div className={styles.header}>
          <div className={styles.headerText}>
            <h1 className={styles.pageTitle}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.titleIcon}>
                <path d="M20 7h-3a2 2 0 0 1-2-2V2"/>
                <rect x="2" y="6" width="20" height="14" rx="2"/>
                <path d="M2 10h20"/>
              </svg>
              Your Trips
            </h1>
            <p className={styles.pageSubtitle}>Manage your upcoming stays and booking history</p>
          </div>
        </div>

        {/* Search Bar — only show when NOT authenticated */}
        {!userEmail && (
        <form onSubmit={handleLookup} className={styles.searchBar}>
          <div className={styles.searchInputWrap}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={styles.searchIcon}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Enter your Guest ID to view reservations"
              value={guestId}
              onChange={(e) => setGuestId(e.target.value)}
              required
            />
          </div>
          <button type="submit" className={styles.searchBtn} disabled={loading}>
            {loading ? <><span className={styles.spinner}></span>Searching</> : 'Find my trips'}
          </button>
        </form>
        )}

        {/* Stats Bar */}
        {searched && reservations.length > 0 && (
          <div className={styles.statsBar}>
            <div className={styles.statChip}>
              <span className={styles.statNumber}>{upcomingCount}</span>
              <span className={styles.statLabel}>Upcoming</span>
            </div>
            <div className={styles.statChip}>
              <span className={styles.statNumber}>{pastCount}</span>
              <span className={styles.statLabel}>Past</span>
            </div>
            <div className={styles.statChip}>
              <span className={styles.statNumber}>{cancelledCount}</span>
              <span className={styles.statLabel}>Cancelled</span>
            </div>
            <div className={styles.statChip}>
              <span className={styles.statNumber}>{reservations.length}</span>
              <span className={styles.statLabel}>Total</span>
            </div>
          </div>
        )}

        {/* Tabs */}
        {searched && reservations.length > 0 && (
          <div className={styles.tabs}>
            {['all', 'upcoming', 'past', 'cancelled'].map((tab) => (
              <button
                key={tab}
                className={`${styles.tab} ${activeTab === tab ? styles.tabActive : ''}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        )}

        {/* Messages */}
        {successMsg && (
          <div className={styles.successMsg}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
            {successMsg}
          </div>
        )}
        {error && <div className={styles.errorMsg}>{error}</div>}

        {/* Empty State */}
        {searched && !loading && filtered.length === 0 && !error && (
          <div className={styles.emptyState}>
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className={styles.emptyIcon}>
              <rect x="2" y="3" width="20" height="18" rx="2"/>
              <path d="M8 7h8M8 11h5M8 15h3"/>
            </svg>
            <h3 className={styles.emptyTitle}>No trips found</h3>
            <p className={styles.emptyText}>
              {activeTab !== 'all'
                ? `You don't have any ${activeTab} reservations.`
                : "We couldn't find any bookings. Double-check your ID or browse hotels to book your next stay."}
            </p>
            <Link to="/search" className={styles.emptyCta}>Browse Hotels</Link>
          </div>
        )}

        {/* Results */}
        {filtered.length > 0 && (
          <div className={styles.resultsList}>
            {filtered.map((r) => (
              <div key={r.reservation_id} className={styles.reservationCard}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardHeaderLeft}>
                    <span className={styles.reservationId}>#{r.reservation_id}</span>
                    <span className={styles.hotelName}>{r.hotel_name || 'Hotel'}</span>
                  </div>
                  <span className={`${styles.statusBadge} ${r.status === 'CONFIRMED' ? styles.statusConfirmed : styles.statusCancelled}`}>
                    {r.status}
                  </span>
                </div>

                <div className={styles.cardBody}>
                  <div className={styles.cardRow}>
                    <span className={styles.cardLabel}>Room</span>
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
                    <span className={styles.cardLabel}>Total</span>
                    <span className={`${styles.cardValue} ${styles.amount}`}>€{Number(r.amount).toFixed(2)}</span>
                  </div>
                </div>

                <div className={styles.cardFooter}>
                  {r.status === 'CONFIRMED' && (
                    <>
                      {confirmCancel === r.reservation_id ? (
                        <div className={styles.confirmDialog}>
                          <p>Cancel reservation #{r.reservation_id}?</p>
                          <div className={styles.confirmActions}>
                            <button className={styles.confirmYes} onClick={() => handleCancel(r.reservation_id)}>Yes, cancel</button>
                            <button className={styles.confirmNo} onClick={() => setConfirmCancel(null)}>Keep it</button>
                          </div>
                        </div>
                      ) : (
                        <button className={styles.cancelBtn} onClick={() => setConfirmCancel(r.reservation_id)}>
                          Cancel Reservation
                        </button>
                      )}
                    </>
                  )}
                  <div className={styles.cardActions}>
                    <span className={styles.actionLink}>View Details</span>
                    <span className={styles.actionLink}>Download Invoice</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pre-search state — only for unauthenticated users */}
        {!searched && !userEmail && (
          <div className={styles.emptyState}>
            <svg width="56" height="56" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" className={styles.emptyIcon}>
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
            </svg>
            <h3 className={styles.emptyTitle}>Ready to check your trips?</h3>
            <p className={styles.emptyText}>Enter your Guest ID above to see all your upcoming and past reservations.</p>
          </div>
        )}
      </div>
    </div>
  );
}
