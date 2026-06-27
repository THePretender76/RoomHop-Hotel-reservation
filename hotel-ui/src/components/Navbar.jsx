import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import styles from './Navbar.module.css';

export default function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [location]);

  const isHome = location.pathname === '/';

  return (
    <header className={`${styles.header} ${scrolled ? styles.scrolled : ''}`}>
      <nav className={styles.nav}>
        <Link to="/" className={styles.brand}>
          <img src="http://localhost:9000/hotels/logo.png" alt="RoomHop" className={styles.brandLogo} />
          <span className={styles.brandName}>RoomHop</span>
        </Link>

        <div className={styles.links}>
          {isHome && (
            <>
              <a href="#features" className={styles.link}>Features</a>
              <a href="#gallery" className={styles.link}>Gallery</a>
              <a href="#testimonials" className={styles.link}>Reviews</a>
              <a href="#stats" className={styles.link}>Stats</a>
            </>
          )}
          <Link to="/search" className={styles.link}>Search</Link>
          <Link to="/reservations" className={styles.link}>My Reservations</Link>
        </div>

        <div className={styles.authButtons}>
          <button className={styles.authBtnOutline}>Sign up</button>
          <button className={styles.authBtnSolid}>Sign in</button>
        </div>

        <button
          className={`${styles.hamburger} ${menuOpen ? styles.hamburgerOpen : ''}`}
          onClick={() => setMenuOpen(!menuOpen)}
          aria-label="Toggle navigation menu"
          aria-expanded={menuOpen}
        >
          <span className={styles.bar} />
          <span className={styles.bar} />
          <span className={styles.bar} />
        </button>
      </nav>

      <div className={`${styles.mobileMenu} ${menuOpen ? styles.mobileMenuOpen : ''}`}>
        {isHome && (
          <>
            <a href="#features" className={styles.mobileLink} onClick={() => setMenuOpen(false)}>Features</a>
            <a href="#gallery" className={styles.mobileLink} onClick={() => setMenuOpen(false)}>Gallery</a>
            <a href="#testimonials" className={styles.mobileLink} onClick={() => setMenuOpen(false)}>Reviews</a>
            <a href="#stats" className={styles.mobileLink} onClick={() => setMenuOpen(false)}>Stats</a>
          </>
        )}
        <Link to="/search" className={styles.mobileLink} onClick={() => setMenuOpen(false)}>Search</Link>
        <Link to="/reservations" className={styles.mobileLink} onClick={() => setMenuOpen(false)}>My Reservations</Link>
        <div className={styles.mobileAuthButtons}>
          <button className={styles.authBtnOutline}>Sign up</button>
          <button className={styles.authBtnSolid}>Sign in</button>
        </div>
      </div>
    </header>
  );
}
