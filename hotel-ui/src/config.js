// Image base URL — uses environment variable for AWS deployment, falls back to localhost MinIO for local dev
export const IMAGES_BASE = import.meta.env.VITE_IMAGES_URL
  || (import.meta.env.PROD ? '' : 'http://localhost:9000/hotels');
export const FALLBACK_IMAGE = `${IMAGES_BASE}/placeholder_images/hotel-1.jpg`;
