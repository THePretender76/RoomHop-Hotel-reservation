# Implementation Plan: RoomHop Booking Platform

## Overview

This plan converts the RoomHop design into incremental coding tasks. The implementation extends the existing `hotel-api` Express app with versioned route modules, creates a standalone `notification-service`, migrates the MySQL schema, reconfigures KrakenD, and enhances the React SPA with the full booking lifecycle. Tasks are ordered so each step produces working, integrated code before the next begins.

---

## Tasks

- [x] 1. Database schema migration and seed data
  - [x] 1.1 Create `database/migration_v2.sql` — drop old tables and create the target schema
    - Drop `Reservations`, `Chambre_Inventory`, `Chambres`, `Chambres_Type`, `Hotel_Images`, `Hotels` (in dependency order)
    - Create `hotel`, `room_type`, `room`, `room_type_rate`, `room_type_inventory`, `guest`, `reservation`, `hotel_images` tables exactly as specified in the design
    - Add all unique constraints: `uq_inventory(hotel_id, room_type_id, date)`, `uq_rate(hotel_id, room_type_id, date)`, unique index on `reservation.idempotency_key`
    - Add performance indexes: `idx_hotel_location`, `idx_inventory_date`, `idx_rate_date`, `idx_reservation_guest`, `idx_reservation_dates`
    - _Requirements: 2.1, 2.2, 2.3, 2.4_

  - [x] 1.2 Create `database/seed_v2.sql` — insert representative test data
    - Insert at least 3 hotels with `hotel_images` entries pointing to existing MinIO keys
    - Insert 2–3 `room_type` rows per hotel with `amenities` JSON
    - Populate `room_type_rate` and `room_type_inventory` for 30 days from today for each room type
    - Insert at least 2 `guest` rows
    - _Requirements: 2.1, 10.1_

- [x] 2. Booking Service — project setup and shared utilities
  - [x] 2.1 Install dependencies and configure Jest in `hotel-api/`
    - Add `jest`, `fast-check` to `devDependencies` in `hotel-api/package.json`
    - Add `"test": "jest --runInBand"` script
    - Create `hotel-api/jest.config.js` with `testEnvironment: 'node'`
    - _Requirements: (test infrastructure)_

  - [x] 2.2 Create `hotel-api/src/middleware/validate.js` — request body validation middleware
    - Export `validateReservationBody(body)` that returns an array of missing required field names from `['hotel_id','room_type_id','guest_id','start_date','end_date','room_count']`
    - Export `validateSearchParams(query)` that returns an array of missing required query param names from `['location','checkIn','checkOut','guests']`
    - _Requirements: 3.8, 1.6, 1.7_

  - [x] 2.3 Write property test for `validateReservationBody`
    - **Property 8: Missing required fields always yield 422 with field names**
    - **Validates: Requirements 3.8**
    - In `hotel-api/__tests__/reservation.property.test.js`
    - For any non-empty subset of required fields omitted, `validateReservationBody` must return an array containing exactly those field names

  - [x] 2.4 Create `hotel-api/src/services/kafkaProducer.js`
    - Install `kafkajs` as a production dependency
    - Connect to broker at `localhost:9022` (use `KAFKA_BROKER` env var with fallback)
    - Export `initProducer()` and `publish(topic, event)` functions
    - Log structured JSON on publish failure without throwing (fire-and-forget)
    - _Requirements: 3.9, 4.6_

- [x] 3. Booking Service — search route
  - [x] 3.1 Create `hotel-api/src/routes/v1/search.js` — `GET /v1/search`
    - Validate required params (`location`, `checkIn`, `checkOut`, `guests`); return 400 with descriptive message on failure
    - Reject `checkIn >= checkOut` with HTTP 400; reject `checkIn` in the past with HTTP 400
    - Execute the full availability SQL query from the design (JOINs across `hotel`, `room_type`, `room_type_inventory`, `room_type_rate`, `hotel_images`)
    - Apply `minPrice` / `maxPrice` HAVING filters when provided
    - Construct `primary_image_url` as `${MINIO_BASE}/hotels/<image_url>` when `image_url` is non-null; return `null` otherwise
    - Return `200` with `{ results: [...] }` — empty array when no matches
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 2.5, 10.2, 10.3_

  - [x] 3.2 Write property tests for the search route logic
    - In `hotel-api/__tests__/search.property.test.js`
    - **Property 1: Search results only contain room types with full-range availability**
      - **Validates: Requirements 1.1, 1.5**
    - **Property 2: Price filter bounds are respected in all results**
      - **Validates: Requirements 1.2**
    - **Property 3: Search result objects are structurally complete**
      - **Validates: Requirements 1.4, 1.8, 10.2, 10.3**
    - **Property 4: Available inventory formula is always total_inventory minus total_reserved**
      - **Validates: Requirements 2.5**

- [x] 4. Booking Service — reservation service and creation route
  - [x] 4.1 Create `hotel-api/src/services/reservationService.js` — encapsulate transaction logic
    - `createReservation(data, idempotencyKey)`: acquire `SELECT FOR UPDATE` on `room_type_inventory` rows for the date range, check availability, INSERT reservation, increment `total_reserved`, commit; handle idempotency key lookup before locking
    - `cancelReservation(reservationId)`: validate existence and `CONFIRMED` status, check 3-day window, UPDATE status to `CANCELLED`, decrement `total_reserved`, commit
    - Wrap both operations in explicit `BEGIN / COMMIT / ROLLBACK` using `db.getConnection()`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 4.2 Write property tests for reservation service logic
    - In `hotel-api/__tests__/reservation.property.test.js`
    - **Property 5: Reservation creation posts correct amount**
      - **Validates: Requirements 3.5**
    - **Property 6: Inventory is conserved across create-then-cancel round trip**
      - **Validates: Requirements 3.3, 4.2**
    - **Property 7: Idempotency key prevents duplicate reservations**
      - **Validates: Requirements 3.6**

  - [x] 4.3 Create `hotel-api/src/routes/v1/reservations.js` — CRUD routes
    - `POST /v1/reservations`: use `validateReservationBody` middleware, call `reservationService.createReservation`, publish `reservation.confirmed` Kafka event, return HTTP 201 with reservation object
    - `GET /v1/reservations`: require `guest_id` query param (HTTP 400 if missing), return reservations ordered by `created_at DESC`
    - `GET /v1/reservations/:id`: return full reservation detail with hotel and room type names via JOIN; HTTP 404 if not found
    - `DELETE /v1/reservations/:id`: call `reservationService.cancelReservation`, publish `reservation.cancelled` Kafka event, return HTTP 200; map service errors to HTTP 403/404/409
    - _Requirements: 3.1, 3.7, 3.8, 3.9, 4.1, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 4.4 Write property tests for cancellation window and reservation list
    - In `hotel-api/__tests__/cancellation.property.test.js`
    - **Property 10: Cancellation window enforcement**
      - **Validates: Requirements 4.3**
    - In `hotel-api/__tests__/reservationList.property.test.js`
    - **Property 11: Reservation list is ordered by created_at descending**
      - **Validates: Requirements 5.1**
    - **Property 12: Reservation detail response is structurally complete**
      - **Validates: Requirements 5.2**

- [x] 5. Booking Service — app wiring and gateway update
  - [x] 5.1 Update `hotel-api/src/app.js` to mount versioned routes and initialise Kafka
    - Mount `routes/v1/search.js` at `/v1/search`
    - Mount `routes/v1/reservations.js` at `/v1/reservations`
    - Call `kafkaProducer.initProducer()` at startup (log error and continue if Kafka is unavailable)
    - Keep existing `/hotels` and legacy `/search` routes intact for backwards compatibility
    - Update CORS origin to include `http://localhost:8080` (KrakenD gateway)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 5.2 Update `krakend.json` — replace stub config with the five production endpoints
    - Replace the `/ping` stub with the five endpoints from the design: `GET /v1/search`, `POST /v1/reservations`, `GET /v1/reservations`, `GET /v1/reservations/{id}`, `DELETE /v1/reservations/{id}`
    - Set `"host": ["http://hotel-api:3000"]` for all backends (Docker service name)
    - Set global `"timeout": "3s"`
    - Forward `Idempotency-Key` and `Content-Type` headers to upstream
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

- [x] 6. Checkpoint — Booking Service tests
  - Ensure all Booking Service unit and property tests pass via `npm test` in `hotel-api/`.
  - Verify the server starts cleanly with `node src/app.js`.
  - Ask the user if questions arise before continuing.

- [x] 7. Notification Service — standalone consumer
  - [x] 7.1 Scaffold `notification-service/` as a new Node.js CommonJS package
    - Create `notification-service/package.json` with `kafkajs`, `jest`, `fast-check` dependencies
    - Create `notification-service/src/emailSender.js` — export `sendEmail(to, subject, body)` as a console.log stub
    - Create `notification-service/src/notificationHandler.js` — export `handleConfirmed(event)` and `handleCancelled(event)` that call `sendEmail` with appropriate subject/body
    - _Requirements: 6.1, 6.2, 6.4_

  - [x] 7.2 Create `notification-service/src/consumer.js` — Kafka consumer entry point
    - Subscribe to `hotel.events.reservations` topic with consumer group `notification-service`
    - Parse `reservation.confirmed` and `reservation.cancelled` event types
    - Wrap each message handler in try/catch with per-message retry counter (max 3 attempts, 1-second linear delay between retries)
    - On third failure: log structured JSON `{ guest_id, reservation_id, error }` to stdout and commit the Kafka offset (do NOT make a fourth attempt)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 7.3 Write property tests for the notification retry logic
    - In `notification-service/__tests__/retry.property.test.js`
    - **Property 9: Notification retry count and permanent-failure log**
      - **Validates: Requirements 6.3, 6.5**
    - For any failing send, total attempts must never exceed 3; on third failure a structured log entry must be emitted containing `guest_id`, `reservation_id`, and error reason

- [x] 8. React SPA — API client and search enhancements
  - [x] 8.1 Create `hotel-ui/src/api/client.js` — thin fetch wrapper
    - Export `apiGet(path, params)` and `apiPost(path, body, headers)` that prefix `http://localhost:8080` as the base URL
    - Parse JSON responses and throw structured errors for non-2xx status codes
    - _Requirements: 8.2, 9.2_

  - [x] 8.2 Create `hotel-ui/src/hooks/useSearch.js` — search state hook
    - Manage `loading`, `results`, `error` state
    - Call `GET /v1/search` via `client.apiGet` with all search parameters
    - Return skeleton placeholder count (5) while loading
    - _Requirements: 8.2, 8.3, 8.4_

  - [x] 8.3 Create `hotel-ui/src/components/SkeletonCard.jsx` — loading placeholder
    - Render a pulsing placeholder card matching the dimensions of `HotelCard`
    - Use inline CSS or a CSS module for the shimmer animation
    - _Requirements: 8.3_

  - [x] 8.4 Update `hotel-ui/src/pages/SearchPage.jsx` — wire search to API and add price filters
    - Replace the direct `fetch('http://localhost:3000/search...')` call in `handleSearch` with `useSearch` hook
    - Add `minPrice` and `maxPrice` text fields to the search form (between Stars and the query field)
    - Display `<SkeletonCard />` × 5 while `loading` is true
    - Display an informational message ("No hotels found for your search — try adjusting your filters.") when results array is empty and not loading
    - Pass `onBook` prop to `<HotelCard>` to open the booking modal
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [x] 9. React SPA — booking flow components
  - [x] 9.1 Create `hotel-ui/src/hooks/useBooking.js` — booking state hook
    - On first call per form session, generate a UUID v4 `idempotencyKey` and persist it to session storage under `rh_idempotency_<submissionSessionId>`
    - Reuse the same UUID for retries of the same submission session; generate a new UUID only when the form is reset
    - Call `POST /v1/reservations` via `client.apiPost` with the `Idempotency-Key` header
    - On HTTP 201: persist `reservation_id` to `sessionStorage` under key `rh_last_reservation`
    - Return `{ loading, error, reservation, submit, reset }`
    - _Requirements: 9.2, 9.3, 9.5, 9.6, 9.7_

  - [x] 9.2 Write property tests for `useBooking` idempotency and session storage
    - In `hotel-ui/__tests__/useBooking.property.test.js` using `vitest` + `fast-check`
    - **Property 13: SPA idempotency key is a valid UUID per submission session**
      - **Validates: Requirements 9.6**
    - **Property 14: Confirmed reservation_id is persisted to session storage**
      - **Validates: Requirements 9.7**

  - [x] 9.3 Create `hotel-ui/src/components/BookingModal.jsx` — room type selection and confirmation
    - Accept `hotel` prop with `roomTypes` array; render room type rows with `name`, `amenities`, `nightly_rate`, `max_occupancy`
    - "Confirm Booking" button calls `useBooking.submit()` with `hotel_id`, `room_type_id`, `guest_id`, `start_date`, `end_date`, `room_count`
    - Disable the confirm button and show a spinner while `loading` is true (_Requirements: 9.3_)
    - On `error` with HTTP 409: show inline "Room no longer available — please modify your search." message (_Requirements: 9.5_)
    - On success: render `<ConfirmationBanner>` in place of the form (_Requirements: 9.4_)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x] 9.4 Create `hotel-ui/src/components/ConfirmationBanner.jsx` — booking summary
    - Accept `reservation` prop
    - Display: `reservation_id`, `hotel_name`, `room_type_name`, `start_date`, `end_date`, `room_count`, `amount`
    - _Requirements: 9.4_

  - [x] 9.5 Update `hotel-ui/src/components/HotelCard.jsx` — add `onBook` prop
    - Replace the static "Reserve" button's `onClick` with `() => onBook(hotel)` when `onBook` prop is provided
    - Keep existing rendering logic unchanged for cards without the prop
    - _Requirements: 9.1_

- [x] 10. React SPA — responsiveness and visual polish
  - [x] 10.1 Audit and update `hotel-ui/src/pages/SearchPage.module.css`
    - Verify breakpoints at 768px and 1024px with CSS media queries for the hotel grid and search form layout
    - Ensure the fixed navbar has a `backdrop-filter: blur(...)` rule that activates on scroll (via a JS scroll listener adding a CSS class)
    - Confirm brand colours `#F43F5E`, `#FB923C`, `#FFF1F2` are used consistently for primary buttons, accents, and page background
    - _Requirements: 8.5, 8.6, 8.7_

- [x] 11. Final checkpoint — full integration
  - Ensure all tests pass: run `npm test` in `hotel-api/` and `notification-service/`, run `npx vitest --run` in `hotel-ui/`
  - Verify `migration_v2.sql` runs cleanly against the Docker MySQL instance
  - Verify `krakend.json` is valid JSON and the gateway starts without errors
  - Ask the user if any questions arise before marking the spec complete.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP build
- Each task references specific requirements for traceability
- The design uses JavaScript/Node.js (CommonJS) for the API and React/JSX for the SPA — no language selection required
- Property tests use `fast-check` + `jest` in the API services and `fast-check` + `vitest` in the SPA
- Checkpoints (tasks 6 and 11) ensure incremental validation at key milestones
- The legacy `/hotels` and `/search` routes remain mounted to avoid breaking existing Docker integrations during migration
- Kafka producer failures after a committed reservation are intentionally non-fatal (fire-and-forget); the reservation remains the source of truth

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.2"] },
    { "id": 1, "tasks": ["1.2", "2.3", "2.4"] },
    { "id": 2, "tasks": ["3.1", "4.1", "7.1", "8.1"] },
    { "id": 3, "tasks": ["3.2", "4.2", "4.3", "7.2", "8.2", "8.3"] },
    { "id": 4, "tasks": ["4.4", "7.3", "5.1", "8.4"] },
    { "id": 5, "tasks": ["5.2", "9.1"] },
    { "id": 6, "tasks": ["9.2", "9.3"] },
    { "id": 7, "tasks": ["9.4", "9.5"] },
    { "id": 8, "tasks": ["10.1"] }
  ]
}
```
