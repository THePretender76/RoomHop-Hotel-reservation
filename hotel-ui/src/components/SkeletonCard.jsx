/**
 * SkeletonCard — pulsing placeholder that mirrors the HotelCard layout.
 * Uses the Silver Lining palette for the shimmer effect.
 */

const shimmerStyle = {
  background: 'linear-gradient(90deg, #F2F2F2 25%, #E5E5E5 50%, #F2F2F2 75%)',
  backgroundSize: '200% 100%',
  animation: 'skeletonShimmer 1.4s infinite linear',
  borderRadius: '4px',
};

const styles = {
  card: {
    display: 'flex',
    gap: '0',
    background: '#FFFFFF',
    borderRadius: '10px',
    overflow: 'hidden',
    boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
    border: '1px solid #E5E5E5',
  },
  image: {
    ...shimmerStyle,
    width: '240px',
    height: '180px',
    flexShrink: 0,
    borderRadius: 0,
  },
  body: {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '20px 24px',
    flex: '1 1 auto',
    gap: '16px',
  },
  main: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
    flex: '1 1 auto',
  },
  titleLine: {
    ...shimmerStyle,
    height: '18px',
    width: '55%',
  },
  cityLine: {
    ...shimmerStyle,
    height: '14px',
    width: '35%',
  },
  descLine1: {
    ...shimmerStyle,
    height: '12px',
    width: '90%',
  },
  descLine2: {
    ...shimmerStyle,
    height: '12px',
    width: '70%',
  },
  starsLine: {
    ...shimmerStyle,
    height: '12px',
    width: '20%',
  },
  side: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    minWidth: '130px',
  },
  scoreLine: {
    ...shimmerStyle,
    height: '30px',
    width: '50px',
    borderRadius: '6px',
  },
  priceLine: {
    ...shimmerStyle,
    height: '20px',
    width: '70px',
  },
  btnPlaceholder: {
    ...shimmerStyle,
    height: '36px',
    width: '80px',
    borderRadius: '6px',
  },
};

let injected = false;
function injectKeyframes() {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style');
  style.textContent = `
    @keyframes skeletonShimmer {
      0%   { background-position: -200% 0; }
      100% { background-position:  200% 0; }
    }
    @media (max-width: 768px) {
      .skeleton-card-root { flex-direction: column !important; }
      .skeleton-card-img { width: 100% !important; height: 200px !important; }
    }
  `;
  document.head.appendChild(style);
}

export default function SkeletonCard() {
  injectKeyframes();

  return (
    <article
      className="skeleton-card-root"
      style={styles.card}
      aria-hidden="true"
      role="presentation"
      data-testid="skeleton-card"
    >
      <div className="skeleton-card-img" style={styles.image} />
      <div style={styles.body}>
        <div style={styles.main}>
          <div style={styles.titleLine} />
          <div style={styles.cityLine} />
          <div style={styles.descLine1} />
          <div style={styles.descLine2} />
          <div style={styles.starsLine} />
        </div>
        <div style={styles.side}>
          <div style={styles.scoreLine} />
          <div>
            <div style={{ ...styles.priceLine, marginBottom: '8px' }} />
            <div style={styles.btnPlaceholder} />
          </div>
        </div>
      </div>
    </article>
  );
}
