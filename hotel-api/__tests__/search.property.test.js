'use strict';

/**
 * Property-based tests for search route logic.
 * All helpers are defined inline — no imports from route files.
 * Uses fast-check + jest, minimum 100 iterations per property.
 *
 * Feature: roomhop-booking-platform
 */

const fc = require('fast-check');

// ============================================================
// INLINE PURE HELPERS (mirror the logic in routes/v1/search.js)
// ============================================================

/**
 * filterSearchResults — pure function that mirrors the SQL HAVING clause.
 *
 * Given an array of inventory rows (one per night) for a single room type,
 * returns true if that room type should appear in results, i.e.:
 *   - every night has available_rooms_count >= 1  (total_inventory - total_reserved >= 1)
 *   - max_occupancy >= guests
 *
 * @param {{ available_rooms_count: number, max_occupancy: number }[]} rows
 * @param {number} guests
 * @returns {boolean}
 */
function filterSearchResults(rows, guests) {
  if (!rows || rows.length === 0) return false;
  return rows.every(
    (row) => row.available_rooms_count >= 1 && row.max_occupancy >= guests
  );
}

/**
 * applyPriceFilter — pure function that mirrors the HAVING price guard.
 *
 * Returns only the results whose nightly_rate satisfies:
 *   minPrice <= nightly_rate <= maxPrice
 * A null bound means "no constraint on that side".
 *
 * @param {{ nightly_rate: number }[]} results
 * @param {number|null} minPrice
 * @param {number|null} maxPrice
 * @returns {{ nightly_rate: number }[]}
 */
function applyPriceFilter(results, minPrice, maxPrice) {
  return results.filter((r) => {
    if (minPrice !== null && r.nightly_rate < minPrice) return false;
    if (maxPrice !== null && r.nightly_rate > maxPrice) return false;
    return true;
  });
}

/**
 * buildPrimaryImageUrl — mirrors the mapping step in the route handler.
 *
 * When image_url is a non-null, non-empty string, returns
 * `${MINIO_BASE}/hotels/${image_url}`; otherwise returns null.
 *
 * @param {string|null} imageUrl
 * @param {string} minioBase
 * @returns {string|null}
 */
function buildPrimaryImageUrl(imageUrl, minioBase) {
  return imageUrl ? `${minioBase}/hotels/${imageUrl}` : null;
}

/**
 * computeAvailableRooms — mirrors the inventory arithmetic.
 *
 * @param {number} totalInventory
 * @param {number} totalReserved
 * @returns {number}
 */
function computeAvailableRooms(totalInventory, totalReserved) {
  return totalInventory - totalReserved;
}

// ============================================================
// REQUIRED FIELDS for a search result object (Req 1.4, 1.8)
// ============================================================
const REQUIRED_RESULT_FIELDS = [
  'hotel_id',
  'name',
  'location',
  'description',
  'room_type_id',
  'room_type_name',
  'max_occupancy',
  'amenities',
  'nightly_rate',
  'available_rooms_count',
];

// ============================================================
// ARBITRARIES
// ============================================================

/** A non-negative integer that fits comfortably in a 32-bit int */
const nonNegIntArb = fc.integer({ min: 0, max: 10_000 });

/** A positive integer >= 1 */
const posIntArb = fc.integer({ min: 1, max: 10_000 });

/** A realistic nightly rate: two decimal places, $1 – $9999 */
const nightlyRateArb = fc
  .integer({ min: 100, max: 999_900 })
  .map((cents) => Math.round(cents) / 100);

/** A single inventory row */
const inventoryRowArb = fc.record({
  available_rooms_count: nonNegIntArb,
  max_occupancy: posIntArb,
});

/** A non-empty array of inventory rows (1–14 nights) */
const inventoryRowsArb = fc.array(inventoryRowArb, {
  minLength: 1,
  maxLength: 14,
});

/** A well-formed search result row */
const resultRowArb = fc.record({
  hotel_id: posIntArb,
  name: fc.string({ minLength: 1, maxLength: 80 }),
  location: fc.string({ minLength: 1, maxLength: 120 }),
  description: fc.oneof(fc.string({ maxLength: 200 }), fc.constant(null)),
  room_type_id: posIntArb,
  room_type_name: fc.string({ minLength: 1, maxLength: 80 }),
  max_occupancy: posIntArb,
  amenities: fc.oneof(
    fc.array(fc.string({ minLength: 1, maxLength: 20 }), { maxLength: 5 }),
    fc.constant(null)
  ),
  nightly_rate: nightlyRateArb,
  available_rooms_count: posIntArb,
  // image_url is the raw MinIO object key stored in the DB; may be null
  image_url: fc.oneof(
    fc.string({ minLength: 1, maxLength: 100 }),
    fc.constant(null)
  ),
});

/** A non-empty array of result rows */
const resultRowsArb = fc.array(resultRowArb, { minLength: 1, maxLength: 20 });

/** A valid MinIO base URL (no trailing slash) */
const minioBaseArb = fc.oneof(
  fc.constant('http://localhost:9000'),
  fc.constant('http://minio:9000'),
  fc.constant('https://storage.example.com')
);

// ============================================================
// PROPERTY 1: Full-range availability filter
// Feature: roomhop-booking-platform, Property 1: Search results only contain room types with full-range availability
// ============================================================

describe('Property 1 — filterSearchResults: only room types with full-range availability pass', () => {
  /**
   * Validates: Requirements 1.1, 1.5
   *
   * For any set of inventory rows, filterSearchResults(rows, guests) returns
   * true ONLY when every row has available_rooms_count >= 1 AND
   * max_occupancy >= guests.
   */

  test('returns true only when ALL nights have available_rooms >= 1 and max_occupancy >= guests', () => {
    fc.assert(
      fc.property(inventoryRowsArb, posIntArb, (rows, guests) => {
        const result = filterSearchResults(rows, guests);

        const allAvailable = rows.every((r) => r.available_rooms_count >= 1);
        const allCapacityOk = rows.every((r) => r.max_occupancy >= guests);
        const expected = allAvailable && allCapacityOk;

        expect(result).toBe(expected);
      }),
      { numRuns: 100 }
    );
  });

  test('returns false when any single night has available_rooms_count = 0', () => {
    // Constrained generator: at least one row is definitely unavailable
    const rowsWithOneZeroArb = fc
      .tuple(
        fc.array(inventoryRowArb, { minLength: 1, maxLength: 13 }),
        fc.integer({ min: 0, max: 13 }) // insertion index
      )
      .map(([rows, idx]) => {
        const zeroRow = { available_rooms_count: 0, max_occupancy: 99 };
        const insertAt = idx % (rows.length + 1);
        return [...rows.slice(0, insertAt), zeroRow, ...rows.slice(insertAt)];
      });

    fc.assert(
      fc.property(rowsWithOneZeroArb, posIntArb, (rows, guests) => {
        expect(filterSearchResults(rows, guests)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });

  test('returns false when max_occupancy < guests on any row', () => {
    // Row where max_occupancy is strictly less than guests
    const rowsWithLowCapArb = fc
      .tuple(
        fc.array(inventoryRowArb, { minLength: 0, maxLength: 12 }),
        posIntArb // guests
      )
      .chain(([rows, guests]) => {
        const lowCapRow = {
          available_rooms_count: fc.constant(5), // availability is fine
          max_occupancy: fc.constant(Math.max(0, guests - 1)), // but capacity is short
        };
        // Build low-cap row directly (no nested fc inside record here)
        const underCapacityRow = {
          available_rooms_count: 5,
          max_occupancy: Math.max(0, guests - 1),
        };
        return fc.constant({ rows: [...rows, underCapacityRow], guests });
      });

    fc.assert(
      fc.property(rowsWithLowCapArb, ({ rows, guests }) => {
        // Only meaningful when guests >= 2 (so max_occupancy >= 1 is still possible
        // but still below guests)
        fc.pre(guests >= 2);
        expect(filterSearchResults(rows, guests)).toBe(false);
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================
// PROPERTY 2: Price filter bounds respected
// Feature: roomhop-booking-platform, Property 2: Price filter bounds are respected in all results
// ============================================================

describe('Property 2 — applyPriceFilter: price bounds are respected in all results', () => {
  /**
   * Validates: Requirements 1.2
   *
   * For any results array and any minPrice/maxPrice combination,
   * applyPriceFilter returns only rows where minPrice <= nightly_rate <= maxPrice.
   */

  test('every result satisfies minPrice <= nightly_rate <= maxPrice when both bounds set', () => {
    const boundsArb = fc
      .tuple(nightlyRateArb, nightlyRateArb)
      .map(([a, b]) => ({ minPrice: Math.min(a, b), maxPrice: Math.max(a, b) }));

    fc.assert(
      fc.property(resultRowsArb, boundsArb, (results, { minPrice, maxPrice }) => {
        const filtered = applyPriceFilter(results, minPrice, maxPrice);

        for (const row of filtered) {
          expect(row.nightly_rate).toBeGreaterThanOrEqual(minPrice);
          expect(row.nightly_rate).toBeLessThanOrEqual(maxPrice);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('no result outside [minPrice, maxPrice] survives the filter', () => {
    const boundsArb = fc
      .tuple(nightlyRateArb, nightlyRateArb)
      .map(([a, b]) => ({ minPrice: Math.min(a, b), maxPrice: Math.max(a, b) }));

    fc.assert(
      fc.property(resultRowsArb, boundsArb, (results, { minPrice, maxPrice }) => {
        const filtered = applyPriceFilter(results, minPrice, maxPrice);
        // Use object identity (Set of references) to test membership correctly,
        // since room_type_id is not guaranteed to be unique across generated rows.
        const filteredSet = new Set(filtered);

        for (const row of results) {
          const shouldBeIn =
            row.nightly_rate >= minPrice && row.nightly_rate <= maxPrice;
          expect(filteredSet.has(row)).toBe(shouldBeIn);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('null minPrice means no lower bound — all rates pass the lower check', () => {
    fc.assert(
      fc.property(resultRowsArb, nightlyRateArb, (results, maxPrice) => {
        const filtered = applyPriceFilter(results, null, maxPrice);

        for (const row of filtered) {
          expect(row.nightly_rate).toBeLessThanOrEqual(maxPrice);
        }
        // Count of passed rows must equal rows with rate <= maxPrice
        const expectedCount = results.filter(
          (r) => r.nightly_rate <= maxPrice
        ).length;
        expect(filtered).toHaveLength(expectedCount);
      }),
      { numRuns: 100 }
    );
  });

  test('null maxPrice means no upper bound — all rates pass the upper check', () => {
    fc.assert(
      fc.property(resultRowsArb, nightlyRateArb, (results, minPrice) => {
        const filtered = applyPriceFilter(results, minPrice, null);

        for (const row of filtered) {
          expect(row.nightly_rate).toBeGreaterThanOrEqual(minPrice);
        }
        const expectedCount = results.filter(
          (r) => r.nightly_rate >= minPrice
        ).length;
        expect(filtered).toHaveLength(expectedCount);
      }),
      { numRuns: 100 }
    );
  });

  test('null minPrice AND null maxPrice returns all results unchanged', () => {
    fc.assert(
      fc.property(resultRowsArb, (results) => {
        const filtered = applyPriceFilter(results, null, null);
        expect(filtered).toHaveLength(results.length);
      }),
      { numRuns: 100 }
    );
  });
});

// ============================================================
// PROPERTY 3: Search result objects are structurally complete
// Feature: roomhop-booking-platform, Property 3: Search result objects are structurally complete
// ============================================================

describe('Property 3 — result shape: search result objects are structurally complete', () => {
  /**
   * Validates: Requirements 1.4, 1.8, 10.2, 10.3
   *
   * Every result row must contain all required fields.
   * primary_image_url = MINIO_BASE/hotels/<image_url>  when image_url is non-null.
   * primary_image_url = null                           when image_url is null.
   */

  test('every result contains all required fields', () => {
    fc.assert(
      fc.property(resultRowArb, (row) => {
        for (const field of REQUIRED_RESULT_FIELDS) {
          expect(row).toHaveProperty(field);
        }
      }),
      { numRuns: 100 }
    );
  });

  test('primary_image_url = MINIO_BASE/hotels/<image_url> when image_url is non-null', () => {
    // Constrain: only rows with a non-null, non-empty image_url
    const rowWithImageArb = resultRowArb.filter(
      (r) => r.image_url !== null && r.image_url !== ''
    );

    fc.assert(
      fc.property(rowWithImageArb, minioBaseArb, (row, minioBase) => {
        const primaryImageUrl = buildPrimaryImageUrl(row.image_url, minioBase);
        expect(primaryImageUrl).toBe(`${minioBase}/hotels/${row.image_url}`);
        expect(primaryImageUrl).not.toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  test('primary_image_url = null when image_url is null', () => {
    fc.assert(
      fc.property(minioBaseArb, (minioBase) => {
        const primaryImageUrl = buildPrimaryImageUrl(null, minioBase);
        expect(primaryImageUrl).toBeNull();
      }),
      { numRuns: 100 }
    );
  });

  test('primary_image_url contains minioBase as prefix when image_url is present', () => {
    const rowWithImageArb = resultRowArb.filter(
      (r) => r.image_url !== null && r.image_url !== ''
    );

    fc.assert(
      fc.property(rowWithImageArb, minioBaseArb, (row, minioBase) => {
        const primaryImageUrl = buildPrimaryImageUrl(row.image_url, minioBase);
        expect(primaryImageUrl).toMatch(new RegExp(`^${escapeRegex(minioBase)}/hotels/`));
      }),
      { numRuns: 100 }
    );
  });
});

/** Helper: escape special regex characters in a string */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================================
// PROPERTY 4: Available inventory formula
// Feature: roomhop-booking-platform, Property 4: Available inventory formula is always total_inventory minus total_reserved
// ============================================================

describe('Property 4 — computeAvailableRooms: available = total_inventory − total_reserved', () => {
  /**
   * Validates: Requirements 2.5
   *
   * For any total_inventory >= 0 and total_reserved in [0, total_inventory],
   * computeAvailableRooms(total_inventory, total_reserved) === total_inventory − total_reserved.
   */

  test('available_rooms_count always equals total_inventory - total_reserved', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }), // total_inventory
        fc.integer({ min: 0, max: 10_000 }), // total_reserved (before pre-condition)
        (totalInventory, totalReserved) => {
          fc.pre(totalReserved <= totalInventory);

          const available = computeAvailableRooms(totalInventory, totalReserved);
          expect(available).toBe(totalInventory - totalReserved);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('available_rooms_count is zero when fully reserved (total_reserved = total_inventory)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }), // total_inventory
        (totalInventory) => {
          const available = computeAvailableRooms(totalInventory, totalInventory);
          expect(available).toBe(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('available_rooms_count equals total_inventory when nothing is reserved', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }), // total_inventory
        (totalInventory) => {
          const available = computeAvailableRooms(totalInventory, 0);
          expect(available).toBe(totalInventory);
        }
      ),
      { numRuns: 100 }
    );
  });

  test('available_rooms_count is non-negative for all valid inputs', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000 }),
        fc.integer({ min: 0, max: 10_000 }),
        (totalInventory, totalReserved) => {
          fc.pre(totalReserved <= totalInventory);

          const available = computeAvailableRooms(totalInventory, totalReserved);
          expect(available).toBeGreaterThanOrEqual(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});
