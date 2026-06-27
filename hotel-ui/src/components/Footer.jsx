import styles from './Footer.module.css';

export default function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.grid}>
          <div className={styles.brandCol}>
            <div className={styles.brandName}>RoomHop</div>
            <p className={styles.brandDesc}>
              A modern booking experience for travelers who value speed, clarity, and unforgettable stays.
            </p>
            <form className={styles.newsletter} onSubmit={(e) => e.preventDefault()}>
              <input
                className={styles.emailInput}
                type="email"
                placeholder="Enter your email"
                aria-label="Newsletter email"
              />
              <button type="submit" className={styles.subscribeBtn}>Subscribe</button>
            </form>
          </div>

          <div className={styles.linkCol}>
            <h4 className={styles.colTitle}>Company</h4>
            <ul className={styles.linkList}>
              <li><a href="#features">Features</a></li>
              <li><a href="#gallery">Gallery</a></li>
              <li><a href="#testimonials">Testimonials</a></li>
              <li><a href="#stats">Statistics</a></li>
            </ul>
          </div>

          <div className={styles.linkCol}>
            <h4 className={styles.colTitle}>Support</h4>
            <ul className={styles.linkList}>
              <li><a href="#map">Location</a></li>
              <li><a href="#search">Search Hotels</a></li>
              <li><a href="#">Help Center</a></li>
              <li><a href="#">Contact Us</a></li>
            </ul>
          </div>

          <div className={styles.linkCol}>
            <h4 className={styles.colTitle}>Legal</h4>
            <ul className={styles.linkList}>
              <li><a href="#">Privacy Policy</a></li>
              <li><a href="#">Terms of Service</a></li>
              <li><a href="#">Cookie Policy</a></li>
            </ul>
          </div>
        </div>

        <div className={styles.bottom}>
          <div className={styles.social}>
            <button className={styles.socialBtn} aria-label="Facebook">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>
            </button>
            <button className={styles.socialBtn} aria-label="Twitter">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M23 3a10.9 10.9 0 0 1-3.14 1.53 4.48 4.48 0 0 0-7.86 3v1A10.66 10.66 0 0 1 3 4s-4 9 5 13a11.64 11.64 0 0 1-7 2c9 5 20 0 20-11.5a4.5 4.5 0 0 0-.08-.83A7.72 7.72 0 0 0 23 3z"/></svg>
            </button>
            <button className={styles.socialBtn} aria-label="Instagram">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" y1="6.5" x2="17.51" y2="6.5"/></svg>
            </button>
            <button className={styles.socialBtn} aria-label="LinkedIn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6zM2 9h4v12H2zM4 2a2 2 0 1 1 0 4 2 2 0 0 1 0-4z"/></svg>
            </button>
          </div>
          <p className={styles.copyright}>© 2026 RoomHop. Designed for modern travelers.</p>
        </div>
      </div>
    </footer>
  );
}
