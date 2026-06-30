import { useLocation, useNavigate, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useBooking } from '../hooks/useBooking';
import { useAuth } from '../auth/AuthContext';
import { isAuthEnabled } from '../auth/amplifyConfig';
import { IMAGES_BASE } from '../config';
import styles from './BookingPage.module.css';

const NATIONALITIES = [
  '', 'Afghan', 'Albanian', 'Algerian', 'American', 'Argentinian', 'Australian',
  'Austrian', 'Belgian', 'Brazilian', 'British', 'Bulgarian', 'Canadian',
  'Chilean', 'Chinese', 'Colombian', 'Croatian', 'Czech', 'Danish', 'Dutch',
  'Egyptian', 'Finnish', 'French', 'German', 'Greek', 'Hungarian', 'Indian',
  'Indonesian', 'Iranian', 'Iraqi', 'Irish', 'Israeli', 'Italian', 'Japanese',
  'Korean', 'Lebanese', 'Malaysian', 'Mexican', 'Moroccan', 'New Zealander',
  'Nigerian', 'Norwegian', 'Pakistani', 'Peruvian', 'Philippine', 'Polish',
  'Portuguese', 'Romanian', 'Russian', 'Saudi', 'Serbian', 'Singaporean',
  'South African', 'Spanish', 'Swedish', 'Swiss', 'Thai', 'Turkish',
  'Ukrainian', 'Emirati', 'Vietnamese',
];

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export default function BookingPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { hotel, roomType, checkIn, checkOut, guests } = location.state || {};
  const { loading, error, reservation, submit } = useBooking();
  const { user } = useAuth();

  // Redirect if accessed directly without state
  useEffect(() => {
    if (!hotel || !roomType) {
      navigate('/search', { replace: true });
    }
  }, [hotel, roomType, navigate]);

  // Guest form state — pre-fill from Cognito attributes when auth is enabled
  const cognitoAttrs = isAuthEnabled() && user?.attributes ? user.attributes : null;
  const [firstName, setFirstName] = useState(cognitoAttrs?.given_name || '');
  const [lastName, setLastName] = useState(cognitoAttrs?.family_name || '');
  const [email, setEmail] = useState(cognitoAttrs?.email || '');
  const [phone, setPhone] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [nationality, setNationality] = useState('');
  const [specialRequests, setSpecialRequests] = useState('');

  // Touched state for inline validation
  const [touched, setTouched] = useState({});

  if (!hotel || !roomType) return null;

  // Calculate nights and pricing
  const nights = Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24));
  const nightlyRate = parseFloat(roomType.nightly_rate);
  const total = nightlyRate * nights;

  // Generate per-date pricing table
  const dateRows = [];
  const startDate = new Date(checkIn);
  for (let i = 0; i < nights; i++) {
    const d = new Date(startDate);
    d.setDate(d.getDate() + i);
    dateRows.push({
      date: d.toISOString().split('T')[0],
      price: nightlyRate,
    });
  }

  // Validation
  const emailValid = isValidEmail(email);
  const formComplete = firstName.trim() && lastName.trim() && email.trim() && phone.trim();
  const canSubmit = formComplete && emailValid && !loading;

  // Helper text logic
  let helperText = '';
  if (!formComplete) {
    helperText = 'Please complete your personal details below to confirm.';
  } else if (!emailValid) {
    helperText = 'Please enter a valid email address.';
  }

  const handleBlur = (field) => {
    setTouched((prev) => ({ ...prev, [field]: true }));
  };

  const handleConfirm = async () => {
    if (!canSubmit) return;
    try {
      await submit({
        hotel_id: hotel.hotel_id,
        room_type_id: roomType.room_type_id,
        guest_id: 1,
        start_date: checkIn,
        end_date: checkOut,
        room_count: 1,
        guest_email: email.trim(),
        guest_first_name: firstName.trim(),
        guest_last_name: lastName.trim(),
        guest_phone: phone.trim(),
        guest_dob: dateOfBirth || null,
        guest_nationality: nationality || null,
        hotel_name: hotel.name,
        room_type_name: roomType.name,
      });
    } catch {
      // error captured in hook state
    }
  };

  // Success state
  if (reservation) {
    const confirmNights = Math.ceil((new Date(checkOut) - new Date(checkIn)) / (1000*60*60*24));
    const confirmNightlyRate = parseFloat(roomType.nightly_rate);
    const confirmTotal = parseFloat(reservation.amount);

    return (
      <div className={styles.page}>
        <div className={styles.confirmationPage}>
          {/* Hero banner with hotel image */}
          <div className={styles.confirmHero} style={{ backgroundImage: `url(${hotel.primary_image_url || ''})` }}>
            <div className={styles.confirmHeroOverlay} />
            <div className={styles.confirmHeroContent}>
              {/* Animated checkmark */}
              <div className={styles.checkmarkCircle}>
                <svg className={styles.checkmarkSvg} viewBox="0 0 52 52">
                  <circle className={styles.checkmarkRing} cx="26" cy="26" r="25" fill="none"/>
                  <path className={styles.checkmarkCheck} fill="none" d="M14.1 27.2l7.1 7.2 16.7-16.8"/>
                </svg>
              </div>
              <h1 className={styles.confirmTitle}>Booking Confirmed!</h1>
              <p className={styles.confirmSubtitle}>Confirmed for: {firstName} {lastName}</p>
            </div>
          </div>

          <div className={styles.confirmContainer}>
            {/* Email reassurance */}
            <div className={styles.reassuranceBanner}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
              A confirmation email has been sent to <strong>{email}</strong>
            </div>

            {/* Main confirmation card */}
            <div className={styles.confirmCard}>
              {/* Hotel & Reservation Info */}
              <div className={styles.confirmSection2}>
                <div className={styles.confirmSectionHeader}>
                  <h2 className={styles.confirmSectionTitle2}>Reservation Details</h2>
                  <span className={styles.reservationBadge}>#{reservation.reservation_id}</span>
                </div>
                
                <div className={styles.hotelBlock}>
                  <h3 className={styles.confirmHotelName}>{hotel.name}</h3>
                  <p className={styles.confirmHotelAddress}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                    {hotel.location}
                    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(hotel.location)}`} target="_blank" rel="noopener noreferrer" className={styles.mapLink}>View on Map →</a>
                  </p>
                  <div className={styles.hotelMeta}>
                    <span className={styles.starRating}>★★★★★ 4.7/5</span>
                    <span className={styles.reviewCount}>1,240 reviews</span>
                  </div>
                  {roomType.image_url && (
                    <img src={roomType.image_url} alt={roomType.name} className={styles.confirmRoomImage} />
                  )}
                </div>

                <div className={styles.detailsGrid}>
                  <div className={styles.detailItem}>
                    <span className={styles.detailLabel}>Room Type</span>
                    <span className={styles.detailValue}>{roomType.name}</span>
                  </div>
                  <div className={styles.detailItem}>
                    <span className={styles.detailLabel}>Guests</span>
                    <span className={styles.detailValue}>{guests} guest{guests !== 1 ? 's' : ''}</span>
                  </div>
                  <div className={styles.detailItem}>
                    <span className={styles.detailLabel}>Check-in</span>
                    <span className={styles.detailValue}>{checkIn} · 3:00 PM</span>
                  </div>
                  <div className={styles.detailItem}>
                    <span className={styles.detailLabel}>Check-out</span>
                    <span className={styles.detailValue}>{checkOut} · 11:00 AM</span>
                  </div>
                  <div className={styles.detailItem}>
                    <span className={styles.detailLabel}>Duration</span>
                    <span className={styles.detailValue}>{confirmNights} night{confirmNights !== 1 ? 's' : ''}</span>
                  </div>
                  <div className={styles.detailItem}>
                    <span className={styles.detailLabel}>Rooms</span>
                    <span className={styles.detailValue}>{reservation.room_count}</span>
                  </div>
                </div>
              </div>

              {/* Price Breakdown */}
              <div className={styles.confirmSection2}>
                <h2 className={styles.confirmSectionTitle2}>Price Breakdown</h2>
                <div className={styles.priceBreakdown}>
                  <div className={styles.priceLine}>
                    <span>€{confirmNightlyRate} × {confirmNights} night{confirmNights !== 1 ? 's' : ''}</span>
                    <span>€{confirmTotal.toFixed(2)}</span>
                  </div>
                  <div className={`${styles.priceLine} ${styles.priceTotal}`}>
                    <span>Total</span>
                    <span>€{confirmTotal.toFixed(2)}</span>
                  </div>
                </div>
              </div>

              {/* Payment & Policy */}
              <div className={styles.confirmSection2}>
                <h2 className={styles.confirmSectionTitle2}>Payment & Policy</h2>
                <div className={styles.policyGrid}>
                  <div className={styles.policyItem}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>
                    <span>Pay at hotel — no advance payment required</span>
                  </div>
                  <div className={styles.policyItem}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    <span>Free cancellation until 3 days after booking</span>
                  </div>
                  <div className={styles.policyItem}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    <span>Secure SSL booking · PCI compliant</span>
                  </div>
                </div>
              </div>

              {/* Hotel Contact */}
              <div className={styles.confirmSection2}>
                <h2 className={styles.confirmSectionTitle2}>Hotel Contact</h2>
                <div className={styles.contactGrid}>
                  <div className={styles.contactItem}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
                    <span>+33 1 42 60 30 70</span>
                  </div>
                  <div className={styles.contactItem}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
                    <span>reservations@roomhop.com</span>
                  </div>
                  <div className={styles.contactItem}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
                    <span>24/7 Customer Support</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className={styles.confirmActions}>
              <Link to="/reservations" className={styles.confirmPrimaryBtn}>View My Reservations</Link>
              <button className={styles.confirmSecondaryBtn} onClick={() => window.print()}>Download PDF Receipt</button>
              <Link to="/search" className={styles.confirmSecondaryBtn}>Book Another Stay</Link>
            </div>

            {/* Trust Footer */}
            <div className={styles.trustFooter}>
              <span>🔒 Secured by RoomHop</span>
              <span>·</span>
              <span>Booking Guarantee</span>
              <span>·</span>
              <span>Best Price Promise</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        {/* Back Link */}
        <Link to="/search" className={styles.backLink}>
          ← Back to search results
        </Link>

        {/* Section 1: Hotel & Room Summary */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Hotel &amp; Room Summary</h2>
          <div className={styles.summaryHeader}>
            <img
              src={hotel.primary_image_url || `${IMAGES_BASE}/placeholder_image/hotel-1.jpg`}
              alt={hotel.name}
              className={styles.summaryImage}
            />
            <div className={styles.summaryInfo}>
              <h1 className={styles.hotelName}>{hotel.name}</h1>
              <p className={styles.hotelLocation}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                  <circle cx="12" cy="10" r="3" />
                </svg>
                {hotel.location}
              </p>
              <p className={styles.cancellationPolicy}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                Free cancellation within 3 days of booking
              </p>
            </div>
          </div>

          {/* Dates Strip */}
          <div className={styles.datesStrip}>
            <div className={styles.dateBlock}>
              <span className={styles.dateLabel}>Check-in</span>
              <span className={styles.dateValue}>{checkIn}</span>
            </div>
            <div className={styles.dateBlock}>
              <span className={styles.dateLabel}>Check-out</span>
              <span className={styles.dateValue}>{checkOut}</span>
            </div>
            <div className={styles.guestsBlock}>
              <span className={styles.dateLabel}>Guests</span>
              <span className={styles.dateValue}>{guests} guest{guests !== 1 ? 's' : ''}</span>
            </div>
          </div>

          {/* Selected Room Card */}
          <div className={styles.roomCard}>
            {roomType.image_url && (
              <img
                src={roomType.image_url}
                alt={roomType.name}
                className={styles.roomCardImage}
              />
            )}
            <div className={styles.roomCardBody}>
              <div className={styles.roomCardHeader}>
                <span className={styles.roomName}>{roomType.name}</span>
                <span className={styles.roomRate}>€{nightlyRate}<small>/night</small></span>
              </div>
              <p className={styles.roomMeta}>Up to {roomType.max_occupancy} guests · {roomType.available_rooms_count} room{roomType.available_rooms_count > 1 ? 's' : ''} available</p>
              <p className={styles.roomAmenities}>
                {Array.isArray(roomType.amenities) ? roomType.amenities.join(', ') : roomType.amenities || ''}
              </p>
            </div>
          </div>
        </section>

        {/* Section 2: Price Breakdown */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Price Breakdown</h2>
          <table className={styles.priceTable}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Price</th>
              </tr>
            </thead>
            <tbody>
              {dateRows.map((row) => (
                <tr key={row.date}>
                  <td>{row.date}</td>
                  <td>€{row.price}</td>
                </tr>
              ))}
              <tr className={styles.totalRow}>
                <td>Total ({nights} night{nights !== 1 ? 's' : ''})</td>
                <td>€{total}</td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* Section 3: Guest Details */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Guest Details</h2>
          <div className={styles.formGrid}>
            {/* First Name */}
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="bp-first">First Name *</label>
              <input
                id="bp-first"
                className={`${styles.fieldInput} ${touched.firstName && !firstName.trim() ? styles.fieldError : ''}`}
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                onBlur={() => handleBlur('firstName')}
                placeholder="Enter your first name"
                autoFocus
                required
              />
              {touched.firstName && !firstName.trim() && (
                <span className={styles.fieldErrorMsg}>First name is required</span>
              )}
            </div>

            {/* Last Name */}
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="bp-last">Last Name *</label>
              <input
                id="bp-last"
                className={`${styles.fieldInput} ${touched.lastName && !lastName.trim() ? styles.fieldError : ''}`}
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                onBlur={() => handleBlur('lastName')}
                placeholder="Enter your last name"
                required
              />
              {touched.lastName && !lastName.trim() && (
                <span className={styles.fieldErrorMsg}>Last name is required</span>
              )}
            </div>

            {/* Email */}
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="bp-email">Email *</label>
              <input
                id="bp-email"
                className={`${styles.fieldInput} ${touched.email && (!email.trim() || !emailValid) ? styles.fieldError : ''}`}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => handleBlur('email')}
                placeholder="Enter your email address"
                required
              />
              {touched.email && !email.trim() && (
                <span className={styles.fieldErrorMsg}>Email is required</span>
              )}
              {touched.email && email.trim() && !emailValid && (
                <span className={styles.fieldErrorMsg}>Please enter a valid email address</span>
              )}
            </div>

            {/* Phone */}
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="bp-phone">Phone Number *</label>
              <input
                id="bp-phone"
                className={`${styles.fieldInput} ${touched.phone && !phone.trim() ? styles.fieldError : ''}`}
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onBlur={() => handleBlur('phone')}
                placeholder="Enter your phone number"
                required
              />
              {touched.phone && !phone.trim() && (
                <span className={styles.fieldErrorMsg}>Phone number is required</span>
              )}
            </div>

            {/* Nationality */}
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="bp-dob">Date of Birth</label>
              <input
                id="bp-dob"
                className={styles.fieldInput}
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                placeholder="YYYY-MM-DD"
              />
            </div>

            {/* Nationality */}
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor="bp-nationality">Nationality</label>
              <select
                id="bp-nationality"
                className={styles.fieldSelect}
                value={nationality}
                onChange={(e) => setNationality(e.target.value)}
              >
                <option value="">Select nationality</option>
                {NATIONALITIES.filter(Boolean).map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>

            {/* Special Requests */}
            <div className={`${styles.field} ${styles.fieldFull}`}>
              <label className={styles.fieldLabel} htmlFor="bp-requests">Special Requests</label>
              <textarea
                id="bp-requests"
                className={styles.fieldTextarea}
                value={specialRequests}
                onChange={(e) => setSpecialRequests(e.target.value)}
                placeholder="Any special requests? (e.g. early check-in, extra pillows)"
              />
            </div>
          </div>
        </section>

        {/* Section 4: Payment Details */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Payment Details</h2>
          <div className={styles.paymentNote}>
            <span className={styles.paymentNoteIcon}>💳</span>
            <span>No payment required at this time. Pay at the hotel.</span>
          </div>
        </section>

        {/* Error */}
        {error && (
          <div className={styles.errorBanner}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
            {error.status === 409
              ? 'Room no longer available — please modify your search.'
              : error.message || 'Booking failed. Please try again.'}
          </div>
        )}

        {/* Section 5: Confirm Booking */}
        <section className={`${styles.section} ${styles.confirmSection}`}>
          {helperText && <p className={styles.helperText}>{helperText}</p>}
          <button
            className={styles.confirmBtn}
            onClick={handleConfirm}
            disabled={!canSubmit}
          >
            {loading ? 'Booking...' : 'Confirm Booking'}
          </button>
        </section>
      </div>
    </div>
  );
}
