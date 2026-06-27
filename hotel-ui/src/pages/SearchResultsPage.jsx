import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import SkeletonCard from '../components/SkeletonCard';
import { useSearch } from '../hooks/useSearch';
import styles from './SearchResultsPage.module.css';

const AMENITY_CATEGORIES = {
  'Room Features': ['WiFi', 'Air Conditioning', 'Safe', 'Flat-screen TV', 'Smart TV', 'Nespresso Machine', 'Mini Bar', 'Extra Beds'],
  'Views': ['City View', 'Sea View', 'Opera View'],
  'Services & Leisure': ['Breakfast Included', 'Butler Service', 'Jacuzzi', 'Lounge Area', 'Private Terrace', 'Beach Access', 'Original Artwork'],
};

export default function SearchResultsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { loading, results, error, skeletonCount, search } = useSearch();
  const [hasSearched, setHasSearched] = useState(false);

  // Form state from URL params
  const [city, setCity] = useState(searchParams.get('location') || '');
  const [checkIn, setCheckIn] = useState(searchParams.get('checkIn') || '');
  const [checkOut, setCheckOut] = useState(searchParams.get('checkOut') || '');
  const [guests, setGuests] = useState(Number(searchParams.get('guests')) || 2);
  const [minPrice, setMinPrice] = useState(searchParams.get('minPrice') || '');
  const [maxPrice, setMaxPrice] = useState(searchParams.get('maxPrice') || '');
  const [stars, setStars] = useState(searchParams.get('stars') || '');
  const [selectedAmenities, setSelectedAmenities] = useState([]);

  // Auto-search on mount if URL has params
  useEffect(() => {
    const location = searchParams.get('location');
    if (location) {
      setHasSearched(true);
      search({
        location,
        checkIn: searchParams.get('checkIn') || undefined,
        checkOut: searchParams.get('checkOut') || undefined,
        guests: searchParams.get('guests') || undefined,
        minPrice: searchParams.get('minPrice') || undefined,
        maxPrice: searchParams.get('maxPrice') || undefined,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (city) params.set('location', city);
    if (checkIn) params.set('checkIn', checkIn);
    if (checkOut) params.set('checkOut', checkOut);
    if (guests) params.set('guests', guests);
    if (minPrice) params.set('minPrice', minPrice);
    if (maxPrice) params.set('maxPrice', maxPrice);
    if (stars) params.set('stars', stars);
    setSearchParams(params);
    setHasSearched(true);
    search({
      location: city || undefined,
      checkIn: checkIn || undefined,
      checkOut: checkOut || undefined,
      guests: guests || undefined,
      minPrice: minPrice || undefined,
      maxPrice: maxPrice || undefined,
    });
  };

  const hotelResults = (results || []).filter((hotel) => {
    if (selectedAmenities.length === 0) return true;
    const hotelAmenities = Array.isArray(hotel.amenities) ? hotel.amenities : [];
    // Normalize amenity matching to handle variants (Mini Bar/Minibar, Lounge Area/Lounge, Private Terrace/Terrace)
    const normalize = (a) => a.toLowerCase().replace(/[^a-z]/g, '');
    const hotelNormalized = hotelAmenities.map(normalize);
    return selectedAmenities.every((a) => {
      const norm = normalize(a);
      return hotelNormalized.some((h) => h.includes(norm) || norm.includes(h));
    });
  });

  // Group results by hotel_id
  const groupedHotels = (() => {
    const map = new Map();
    for (const row of hotelResults) {
      const id = row.hotel_id;
      if (!map.has(id)) {
        map.set(id, {
          hotel_id: row.hotel_id,
          name: row.name,
          location: row.location,
          description: row.description,
          primary_image_url: row.primary_image_url,
          stars: row.stars,
          roomTypes: [],
        });
      }
      map.get(id).roomTypes.push({
        room_type_id: row.room_type_id,
        name: row.room_type_name,
        nightly_rate: row.nightly_rate,
        max_occupancy: row.max_occupancy,
        available_rooms_count: row.available_rooms_count,
        amenities: row.amenities,
        image_url: row.room_type_image_url,
      });
    }
    return Array.from(map.values());
  })();

  return (
    <div className={styles.page}>
      {/* Search Panel */}
      <section className={styles.searchSection}>
        <div className={styles.container}>
          <div className={styles.searchCard}>
            <div className={styles.searchHeader}>
              <h1 className={styles.searchTitle}>Search Hotels</h1>
              <p className={styles.searchSubtitle}>
                {hasSearched
                  ? `Showing ${groupedHotels.length} hotel${groupedHotels.length !== 1 ? 's' : ''} ${city ? `in ${city}` : ''}`
                  : 'Enter your travel details to find available hotels.'}
              </p>
            </div>
            <div className={styles.searchGrid}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="sr-city">City</label>
                <input
                  id="sr-city"
                  className={styles.input}
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Paris, Tokyo, New York..."
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="sr-checkin">Check-in</label>
                <input
                  id="sr-checkin"
                  className={styles.input}
                  type="date"
                  value={checkIn}
                  onChange={(e) => setCheckIn(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="sr-checkout">Check-out</label>
                <input
                  id="sr-checkout"
                  className={styles.input}
                  type="date"
                  value={checkOut}
                  onChange={(e) => setCheckOut(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="sr-guests">Guests</label>
                <select
                  id="sr-guests"
                  className={styles.input}
                  value={guests}
                  onChange={(e) => setGuests(Number(e.target.value))}
                >
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>{n} Guest{n > 1 ? 's' : ''}</option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="sr-minprice">Min Price</label>
                <input
                  id="sr-minprice"
                  className={styles.input}
                  type="number"
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  placeholder={hasSearched && hotelResults.length > 0 ? `From €${Math.min(...hotelResults.map(h => parseFloat(h.nightly_rate || 0)))}` : 'e.g. 100'}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="sr-maxprice">Max Price</label>
                <input
                  id="sr-maxprice"
                  className={styles.input}
                  type="number"
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  placeholder={hasSearched && hotelResults.length > 0 ? `Up to €${Math.max(...hotelResults.map(h => parseFloat(h.nightly_rate || 0)))}` : 'e.g. 500'}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="sr-stars">Min Stars</label>
                <select
                  id="sr-stars"
                  className={styles.input}
                  value={stars}
                  onChange={(e) => setStars(e.target.value)}
                >
                  <option value="">Any</option>
                  <option value="3">3+ Stars</option>
                  <option value="4">4+ Stars</option>
                  <option value="5">5 Stars</option>
                </select>
              </div>
            </div>
            <div className={styles.amenitiesSection}>
              <label className={styles.label}>Amenities</label>
              {Object.entries(AMENITY_CATEGORIES).map(([category, amenities]) => (
                <details key={category} className={styles.amenityCategory}>
                  <summary className={styles.amenityCategoryTitle}>{category}</summary>
                  <div className={styles.amenitiesGrid}>
                    {amenities.map((amenity) => (
                      <label key={amenity} className={styles.amenityCheckbox}>
                        <input
                          type="checkbox"
                          checked={selectedAmenities.includes(amenity)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedAmenities([...selectedAmenities, amenity]);
                            } else {
                              setSelectedAmenities(selectedAmenities.filter((a) => a !== amenity));
                            }
                          }}
                        />
                        <span className={styles.amenityLabel}>{amenity}</span>
                      </label>
                    ))}
                  </div>
                </details>
              ))}
            </div>
            <button
              className={styles.searchBtn}
              onClick={handleSearch}
              disabled={loading}
            >
              {loading ? 'Searching...' : 'Search hotels'}
            </button>
          </div>
        </div>
      </section>

      {/* Results */}
      <section className={styles.resultsSection}>
        <div className={styles.container}>
          {error && (
            <div className={styles.errorMsg}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
              {error}
            </div>
          )}

          <div className={styles.resultsGrid}>
            {loading
              ? Array.from({ length: skeletonCount || 5 }).map((_, i) => <SkeletonCard key={i} />)
              : groupedHotels.map((hotel) => (
                  <article key={hotel.hotel_id} className={styles.hotelGroupCard}>
                    <div className={styles.hotelGroupTop}>
                      <img
                        src={hotel.primary_image_url || 'http://localhost:9000/hotels/placeholder_image/hotel-1.jpg'}
                        alt={hotel.name}
                        className={styles.hotelGroupImage}
                        loading="lazy"
                      />
                      <div className={styles.hotelGroupOverlay} />
                      <div className={styles.hotelGroupInfo}>
                        <h3 className={styles.hotelGroupName}>{hotel.name}</h3>
                        <p className={styles.hotelGroupLocation}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                          {hotel.location}
                        </p>
                        <p className={styles.hotelGroupDesc}>{hotel.description}</p>
                      </div>
                    </div>
                    <div className={styles.roomTypesSection}>
                      <h4 className={styles.roomTypesTitle}>Available Room Types</h4>
                      {hotel.roomTypes.map((rt) => (
                        <div key={rt.room_type_id} className={styles.roomTypeRow}>
                          <img
                            src={rt.image_url || hotel.primary_image_url || 'http://localhost:9000/hotels/placeholder_image/hotel-1.jpg'}
                            alt={rt.name}
                            className={styles.roomTypeThumb}
                            loading="lazy"
                          />
                          <div className={styles.roomTypeInfo}>
                            <span className={styles.roomTypeName}>{rt.name}</span>
                            <span className={styles.roomTypeMeta}>
                              Up to {rt.max_occupancy} guests · {rt.available_rooms_count} room{rt.available_rooms_count > 1 ? 's' : ''} left
                            </span>
                            <span className={styles.roomTypeAmenities}>
                              {Array.isArray(rt.amenities) ? rt.amenities.join(', ') : ''}
                            </span>
                          </div>
                          <div className={styles.roomTypeActions}>
                            <span className={styles.roomTypePrice}>€{rt.nightly_rate}<small>/night</small></span>
                            <button
                              className={styles.roomTypeBookBtn}
                              onClick={() => navigate('/booking', {
                                state: {
                                  hotel,
                                  roomType: {
                                    room_type_id: rt.room_type_id,
                                    name: rt.name,
                                    nightly_rate: rt.nightly_rate,
                                    max_occupancy: rt.max_occupancy,
                                    amenities: rt.amenities,
                                    available_rooms_count: rt.available_rooms_count,
                                    image_url: rt.image_url,
                                  },
                                  checkIn,
                                  checkOut,
                                  guests,
                                },
                              })}
                            >
                              Reserve
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                ))
            }
          </div>

          {!loading && hasSearched && groupedHotels.length === 0 && (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              </div>
              <h3 className={styles.emptyTitle}>No hotels found</h3>
              <p className={styles.emptyText}>Try adjusting your search criteria — different dates, city, or price range.</p>
            </div>
          )}

          {!hasSearched && (
            <div className={styles.emptyState}>
              <div className={styles.emptyIcon}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
              </div>
              <h3 className={styles.emptyTitle}>Ready to explore?</h3>
              <p className={styles.emptyText}>Enter your destination and dates above to discover available hotels.</p>
            </div>
          )}
        </div>
      </section>

    </div>
  );
}
