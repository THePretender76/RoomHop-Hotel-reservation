import './ConfirmationBanner.css';

/**
 * ConfirmationBanner — displays a booking confirmation summary.
 *
 * Props:
 * - reservation: object with reservation_id, hotel_name, room_type_name,
 *   start_date, end_date, room_count, amount (and fallback fields hotel_id, room_type_id)
 */
export default function ConfirmationBanner({ reservation }) {
  return (
    <div className="confirmation-banner">
      <div className="confirmation-icon">✓</div>
      <h3>Booking Confirmed!</h3>
      <div className="confirmation-details">
        <div className="detail-row">
          <span className="detail-label">Reservation ID</span>
          <span className="detail-value">{reservation.reservation_id}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Hotel</span>
          <span className="detail-value">{reservation.hotel_name || `Hotel #${reservation.hotel_id}`}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Room Type</span>
          <span className="detail-value">{reservation.room_type_name || `Type #${reservation.room_type_id}`}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Dates</span>
          <span className="detail-value">{reservation.start_date} → {reservation.end_date}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Rooms</span>
          <span className="detail-value">{reservation.room_count}</span>
        </div>
        <div className="detail-row">
          <span className="detail-label">Total</span>
          <span className="detail-value amount">€{reservation.amount}</span>
        </div>
      </div>
    </div>
  );
}
