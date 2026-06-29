import { IMAGES_BASE } from '../config';
import styles from './HotelCard.module.css';

export default function HotelCard({ hotel, onBook }) {
  const name = hotel.name || hotel.nom || 'RoomHop Hotel';
  const location = hotel.location || hotel.ville || hotel.city || '';
  const image = hotel.primary_image_url || hotel.image_url || hotel.image || `${IMAGES_BASE}/placeholder_image/hotel-1.jpg`;
  const price = hotel.nightly_rate || hotel.prix || hotel.price || hotel.tarif || hotel.cost || 0;
  const rating = hotel.note || hotel.rating || hotel.score || 4.8;
  const stars = Number(hotel.etoiles || hotel.stars || 5);
  const roomType = hotel.room_type_name || '';
  const occupancy = hotel.max_occupancy || '';
  const available = hotel.available_rooms_count || '';

  const truncate = (text, length) =>
    text?.length > length ? `${text.slice(0, length)}…` : text;

  return (
    <article className={styles.card}>
      <img
        src={image}
        alt={name}
        className={styles.image}
        loading="lazy"
      />
      <div className={styles.body}>
        <div className={styles.main}>
          <h3 className={styles.name}>{name}</h3>
          <p className={styles.location}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
            {location}
          </p>
          <p className={styles.description}>
            {truncate(hotel.description || 'A curated stay designed for modern travelers.', 140)}
          </p>
          {roomType && (
            <p className={styles.meta}>
              {roomType} · Up to {occupancy} guests · {available} room{available > 1 ? 's' : ''} left
            </p>
          )}
          <div className={styles.stars}>
            {'★'.repeat(Math.min(stars, 5))}{'☆'.repeat(5 - Math.min(stars, 5))}
          </div>
        </div>
        <div className={styles.side}>
          <div className={styles.rating}>
            <span className={styles.score}>{rating}</span>
            <span className={styles.reviews}>{hotel.reviews || hotel.reviewsCount || ''}</span>
          </div>
          <div className={styles.priceBlock}>
            <div className={styles.price}>
              €{price}<span className={styles.priceLabel}>/night</span>
            </div>
            <button className={styles.bookBtn} onClick={() => onBook && onBook(hotel)}>
              Reserve
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}
