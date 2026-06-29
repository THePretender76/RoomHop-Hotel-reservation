import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Footer from '../components/Footer';
import { IMAGES_BASE } from '../config';
import styles from './HomePage.module.css';

const MINIO_BASE = `${IMAGES_BASE}/placeholder_image`;

const galleryItems = [
  { id: 'gallery-1', label: 'Modern Suites', src: `${MINIO_BASE}/gallery-1.jpg` },
  { id: 'gallery-2', label: 'Poolside Relax', src: `${MINIO_BASE}/gallery-2.jpg` },
  { id: 'gallery-3', label: 'Scenic Views', src: `${MINIO_BASE}/gallery-3.jpg` },
];

const testimonials = [
  {
    id: 1,
    quote: 'RoomHop made my last-minute trip effortless — the curated hotel picks and transparent booking rules saved me time and stress.',
    name: 'Mia Johnson',
    role: 'Product Manager, London',
  },
  {
    id: 2,
    quote: 'I loved how easy it was to compare rooms and lock in a great deal. The map view and flexible cancellation gave me confidence.',
    name: 'Ethan Lopez',
    role: 'Startup Founder, Madrid',
  },
  {
    id: 3,
    quote: 'The search experience was beautifully simple and the hotel suggestions felt premium without the fluff.',
    name: 'Ayesha Khan',
    role: 'Marketing Director, Dubai',
  },
];

const stats = [
  { label: 'Hotels', target: 500, suffix: '+' },
  { label: 'Happy Guests', target: 10000, suffix: '+' },
  { label: 'Cities', target: 50, suffix: '+' },
  { label: 'Countries', target: 25, suffix: '+' },
];

function AnimatedCounter({ target, suffix, inView }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!inView) return;
    let start = 0;
    const duration = 2000;
    const increment = target / (duration / 16);
    const timer = setInterval(() => {
      start += increment;
      if (start >= target) {
        setCount(target);
        clearInterval(timer);
      } else {
        setCount(Math.floor(start));
      }
    }, 16);
    return () => clearInterval(timer);
  }, [inView, target]);

  return (
    <span className={styles.statNumber}>
      {count.toLocaleString()}{suffix}
    </span>
  );
}

export default function HomePage() {
  const navigate = useNavigate();
  const [city, setCity] = useState('Paris');
  const [checkIn, setCheckIn] = useState('2026-07-15');
  const [checkOut, setCheckOut] = useState('2026-07-20');
  const [guests, setGuests] = useState(2);
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [stars, setStars] = useState('');

  const [showLightbox, setShowLightbox] = useState(false);
  const [lightboxItem, setLightboxItem] = useState(galleryItems[0]);
  const [testimonialIndex, setTestimonialIndex] = useState(0);
  const [statsInView, setStatsInView] = useState(false);
  const statsRef = useRef(null);

  // Fade-in on scroll
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add(styles.visible);
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15 }
    );
    document.querySelectorAll(`.${styles.fadeIn}`).forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Stats counter trigger
  useEffect(() => {
    if (!statsRef.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setStatsInView(true);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );
    observer.observe(statsRef.current);
    return () => observer.disconnect();
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
    navigate(`/search?${params.toString()}`);
  };

  const currentTestimonial = testimonials[testimonialIndex];

  return (
    <div className={styles.page}>
      {/* Hero Section */}
      <section
        className={styles.hero}
        style={{ backgroundImage: `url('${MINIO_BASE}/hero.jpg')` }}
      >
        <div className={styles.heroOverlay} />
        <div className={styles.heroContent}>
          <p className={styles.heroTag}>Travel made simple</p>
          <h1 className={styles.heroTitle}>
            Find your perfect stay,<br />book with confidence.
          </h1>
          <p className={styles.heroSubtitle}>
            Discover curated hotels selected for modern travelers who value speed, clarity, and comfort.
          </p>
          <div className={styles.heroCtas}>
            <button
              className={styles.ctaPrimary}
              onClick={() => document.getElementById('search')?.scrollIntoView({ behavior: 'smooth' })}
            >
              Start searching
            </button>
            <button
              className={styles.ctaSecondary}
              onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })}
            >
              Learn more
            </button>
          </div>
        </div>
      </section>

      {/* Search Form Section */}
      <section id="search" className={`${styles.section} ${styles.fadeIn}`}>
        <div className={styles.container}>
          <div className={styles.searchCard}>
            <h2 className={styles.searchTitle}>Find your next stay</h2>
            <p className={styles.searchSubtitle}>Enter your travel details to discover available hotels.</p>
            <div className={styles.searchGrid}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="hp-city">City</label>
                <input id="hp-city" className={styles.input} type="text" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Paris, Tokyo, New York..." />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="hp-checkin">Check-in</label>
                <input id="hp-checkin" className={styles.input} type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="hp-checkout">Check-out</label>
                <input id="hp-checkout" className={styles.input} type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="hp-guests">Guests</label>
                <select id="hp-guests" className={styles.input} value={guests} onChange={(e) => setGuests(Number(e.target.value))}>
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <option key={n} value={n}>{n} Guest{n > 1 ? 's' : ''}</option>
                  ))}
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="hp-minprice">Min Price</label>
                <input id="hp-minprice" className={styles.input} type="number" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder="e.g. 100" />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="hp-maxprice">Max Price</label>
                <input id="hp-maxprice" className={styles.input} type="number" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="e.g. 500" />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="hp-stars">Min Stars</label>
                <select id="hp-stars" className={styles.input} value={stars} onChange={(e) => setStars(e.target.value)}>
                  <option value="">Any</option>
                  <option value="3">3+ Stars</option>
                  <option value="4">4+ Stars</option>
                  <option value="5">5 Stars</option>
                </select>
              </div>
            </div>
            <button className={styles.searchBtn} onClick={handleSearch}>Search hotels</button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className={`${styles.section} ${styles.sectionAlt} ${styles.fadeIn}`}>
        <div className={styles.container}>
          <h2 className={styles.sectionTitle}>Why travelers choose RoomHop</h2>
          <p className={styles.sectionSubtitle}>Built for speed, transparency, and peace of mind.</p>
          <div className={styles.featuresGrid}>
            {[
              { icon: '⚡', title: 'Fast booking', text: 'Reserve rooms in seconds with instant confirmation and clear pricing.' },
              { icon: '🔍', title: 'Curated selection', text: 'Handpicked stays chosen for comfort, convenience, and stellar reviews.' },
              { icon: '🛡️', title: 'Flexible cancellation', text: 'Transparent policies that keep you agile when plans change.' },
              { icon: '📱', title: 'Travel-ready design', text: 'A polished mobile-first experience built for modern explorers.' },
            ].map((f) => (
              <div key={f.title} className={styles.featureCard}>
                <div className={styles.featureIcon}>{f.icon}</div>
                <h3 className={styles.featureTitle}>{f.title}</h3>
                <p className={styles.featureText}>{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Gallery Section */}
      <section id="gallery" className={`${styles.section} ${styles.fadeIn}`}>
        <div className={styles.container}>
          <h2 className={styles.sectionTitle}>Travel inspiration</h2>
          <p className={styles.sectionSubtitle}>Explore destinations through our curated gallery.</p>
          <div className={styles.galleryGrid}>
            {galleryItems.map((item) => (
              <button
                key={item.id}
                className={styles.galleryItem}
                onClick={() => { setLightboxItem(item); setShowLightbox(true); }}
                type="button"
              >
                <img src={item.src} alt={item.label} className={styles.galleryImg} />
                <span className={styles.galleryLabel}>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials Section */}
      <section id="testimonials" className={`${styles.section} ${styles.sectionAlt} ${styles.fadeIn}`}>
        <div className={styles.container}>
          <h2 className={styles.sectionTitle}>What travelers say</h2>
          <div className={styles.testimonialCard}>
            <blockquote className={styles.testimonialQuote}>
              &ldquo;{currentTestimonial.quote}&rdquo;
            </blockquote>
            <p className={styles.testimonialName}>{currentTestimonial.name}</p>
            <p className={styles.testimonialRole}>{currentTestimonial.role}</p>
            <div className={styles.testimonialControls}>
              <button
                className={styles.controlBtn}
                onClick={() => setTestimonialIndex((i) => (i - 1 + testimonials.length) % testimonials.length)}
                aria-label="Previous testimonial"
              >
                ‹
              </button>
              <div className={styles.dots}>
                {testimonials.map((_, i) => (
                  <span key={i} className={`${styles.dot} ${i === testimonialIndex ? styles.dotActive : ''}`} />
                ))}
              </div>
              <button
                className={styles.controlBtn}
                onClick={() => setTestimonialIndex((i) => (i + 1) % testimonials.length)}
                aria-label="Next testimonial"
              >
                ›
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section id="stats" className={`${styles.section} ${styles.fadeIn}`} ref={statsRef}>
        <div className={styles.container}>
          <h2 className={styles.sectionTitle}>RoomHop by the numbers</h2>
          <div className={styles.statsGrid}>
            {stats.map((s) => (
              <div key={s.label} className={styles.statCard}>
                <AnimatedCounter target={s.target} suffix={s.suffix} inView={statsInView} />
                <span className={styles.statLabel}>{s.label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Map Section */}
      <section id="map" className={`${styles.section} ${styles.sectionAlt} ${styles.fadeIn}`}>
        <div className={styles.container}>
          <h2 className={styles.sectionTitle}>Explore our locations</h2>
          <p className={styles.sectionSubtitle}>Find RoomHop stays across the globe.</p>
          <iframe
            className={styles.map}
            title="RoomHop map"
            src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2624.999840085018!2d2.293857315674888!3d48.85837007928743!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x47e66fdda47cae35%3A0x4ed718e18dfedaf3!2sEiffel%20Tower!5e0!3m2!1sen!2sus!4v1700000000000"
            allowFullScreen
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      </section>

      {/* Footer */}
      <Footer />

      {/* Lightbox */}
      {showLightbox && (
        <div className={styles.lightboxOverlay} onClick={() => setShowLightbox(false)}>
          <div className={styles.lightboxContent} onClick={(e) => e.stopPropagation()}>
            <button className={styles.lightboxClose} onClick={() => setShowLightbox(false)} aria-label="Close lightbox">×</button>
            <img src={lightboxItem.src} alt={lightboxItem.label} className={styles.lightboxImg} />
            <p className={styles.lightboxLabel}>{lightboxItem.label}</p>
          </div>
        </div>
      )}
    </div>
  );
}
