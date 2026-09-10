// Production requests use the RoomHop origin; local development can override it.
const BASE_URL = import.meta.env.PROD
  ? globalThis.location.origin
  : (import.meta.env.VITE_API_URL || 'http://localhost:3000');

// Auth token getter — set by App.jsx to provide JWT from Cognito
let tokenGetter = null;

export function setAuthTokenGetter(getter) {
  tokenGetter = getter;
}

async function getAuthHeaders() {
  if (!tokenGetter) return {};
  try {
    const token = await tokenGetter();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function errorFrom(response) {
  let data = {};
  try {
    data = await response.json();
  } catch {
    // A proxy can return a plain-text or empty error body.
  }
  const error = new Error(data.error || response.statusText || `HTTP ${response.status}`);
  error.status = response.status;
  error.data = data;
  return error;
}

/**
 * Make a GET request to the RoomHop API.
 * @param {string} path - API path, e.g. '/v1/search'
 * @param {Object} params - Query parameters as key/value pairs
 * @returns {Promise<any>} Parsed JSON response body
 * @throws {{ status: number, message: string, data: any }} On non-2xx response
 */
export async function apiGet(path, params = {}) {
  const url = new URL(path, BASE_URL);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, value);
    }
  });

  const authHeaders = await getAuthHeaders();

  const response = await fetch(url.toString(), {
    headers: {
      ...authHeaders,
    },
  });

  if (!response.ok) {
    throw await errorFrom(response);
  }

  return response.json();
}

/**
 * Make a POST request to the RoomHop API.
 * @param {string} path - API path, e.g. '/v1/reservations'
 * @param {Object} body - Request body (will be JSON-serialised)
 * @param {Object} headers - Additional headers (e.g. Idempotency-Key)
 * @returns {Promise<any>} Parsed JSON response body
 * @throws {{ status: number, message: string, data: any }} On non-2xx response
 */
export async function apiPost(path, body = {}, headers = {}) {
  const url = new URL(path, BASE_URL);
  const authHeaders = await getAuthHeaders();

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...headers,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await errorFrom(response);
  }

  return response.json();
}

/**
 * Make a DELETE request to the RoomHop API.
 * @param {string} path - API path, e.g. '/v1/reservations/1'
 * @returns {Promise<any>} Parsed JSON response body
 * @throws {{ status: number, message: string, data: any }} On non-2xx response
 */
export async function apiPut(path, body = {}, headers = {}) {
  const url = new URL(path, BASE_URL);
  const authHeaders = await getAuthHeaders();

  const response = await fetch(url.toString(), {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...headers,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw await errorFrom(response);
  }
  return response.json();
}

export async function apiDelete(path) {
  const url = new URL(path, BASE_URL);
  const authHeaders = await getAuthHeaders();

  const response = await fetch(url.toString(), {
    method: 'DELETE',
    headers: {
      ...authHeaders,
    },
  });

  if (!response.ok) {
    throw await errorFrom(response);
  }
  return response.json();
}
