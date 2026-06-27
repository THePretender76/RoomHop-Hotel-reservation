import { useState } from 'react';
import { useBooking } from '../hooks/useBooking';
import ConfirmationBanner from './ConfirmationBanner';
import './BookingModal.css';

/**
 * BookingModal — allows users to select a room type and confirm a reservation.
 *
 * Props:
 * - hotel: { hotel_id, name, roomTypes }
 * - roomTypes: array of { room_type_id, name, amenities, nightly_rate, max_occupancy }
 * - checkIn: start date string (YYYY-MM-DD)
 * - checkOut: end date string (YYYY-MM-DD)
 * - guests: number of guests
 * - onClose: function to close the modal
 */
export default function BookingModal({ hotel, roomTypes, checkIn, checkOut, guests, onClose }) {
  const [selectedRoomType, setSelectedRoomType] = useState(null);
  const [guestFirstName, setGuestFirstName] = useState('');
  const [guestLastName, setGuestLastName] = useState('');
  const [guestEmail, setGuestEmail] = useState('');
  const { loading, error, reservation, submit } = useBooking();

  const handleConfirm = async () => {
    if (!selectedRoomType || !guestFirstName.trim() || !guestLastName.trim() || !guestEmail.trim()) return;
    try {
      await submit({
        hotel_id: hotel.hotel_id,
        room_type_id: selectedRoomType.room_type_id,
        guest_id: 1, // TODO: create/lookup guest by email
        start_date: checkIn,
        end_date: checkOut,
        room_count: 1,
        guest_email: guestEmail.trim(),
        guest_first_name: guestFirstName.trim(),
        guest_last_name: guestLastName.trim(),
        hotel_name: hotel.name || hotel.nom,
        room_type_name: selectedRoomType.name,
      });
    } catch {
      // error is already captured in hook state
    }
  };

  // Success state — show confirmation banner
  if (reservation) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal-content" onClick={(e) => e.stopPropagation()}>
          <ConfirmationBanner reservation={reservation} />
          <button onClick={onClose} className="modal-close-btn">Close</button>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Reserve at {hotel.name || hotel.nom}</h2>
        <p className="modal-summary">
          {checkIn} → {checkOut} · {guests} guest{guests !== 1 ? 's' : ''}
        </p>

        <div className="room-type-list">
          {roomTypes.map((rt) => (
            <div
              key={rt.room_type_id}
              className={`room-type-row ${selectedRoomType?.room_type_id === rt.room_type_id ? 'selected' : ''}`}
              onClick={() => setSelectedRoomType(rt)}
              role="radio"
              aria-checked={selectedRoomType?.room_type_id === rt.room_type_id}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedRoomType(rt);
                }
              }}
            >
              <div className="room-type-header">
                <span className="room-type-name">{rt.name}</span>
                <span className="room-type-occupancy">Up to {rt.max_occupancy} guests</span>
              </div>
              <div className="room-type-amenities">
                {Array.isArray(rt.amenities) ? rt.amenities.join(', ') : rt.amenities || ''}
              </div>
              <div className="room-rate">€{rt.nightly_rate}/night</div>
            </div>
          ))}
        </div>

        {error && error.status === 409 && (
          <p className="error-message">Room no longer available — please modify your search.</p>
        )}
        {error && error.status !== 409 && (
          <p className="error-message">{error.message || 'Booking failed. Please try again.'}</p>
        )}

        <div className="guest-form">
          <h3 className="guest-form-title">Your Details</h3>
          <div className="guest-form-grid">
            <div className="guest-field">
              <label htmlFor="guest-first">First Name *</label>
              <input
                id="guest-first"
                type="text"
                value={guestFirstName}
                onChange={(e) => setGuestFirstName(e.target.value)}
                placeholder="John"
                required
              />
            </div>
            <div className="guest-field">
              <label htmlFor="guest-last">Last Name *</label>
              <input
                id="guest-last"
                type="text"
                value={guestLastName}
                onChange={(e) => setGuestLastName(e.target.value)}
                placeholder="Doe"
                required
              />
            </div>
            <div className="guest-field guest-field-full">
              <label htmlFor="guest-email">Email Address *</label>
              <input
                id="guest-email"
                type="email"
                value={guestEmail}
                onChange={(e) => setGuestEmail(e.target.value)}
                placeholder="john.doe@example.com"
                required
              />
            </div>
          </div>
        </div>

        <button
          onClick={handleConfirm}
          disabled={loading || !selectedRoomType || !guestFirstName.trim() || !guestLastName.trim() || !guestEmail.trim()}
          className="confirm-btn"
        >
          {loading ? 'Booking...' : 'Confirm Booking'}
        </button>
      </div>
    </div>
  );
}
