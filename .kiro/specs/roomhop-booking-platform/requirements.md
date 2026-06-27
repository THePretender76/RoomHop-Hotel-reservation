# Requirements Document

## Introduction

RoomHop is a next-generation single-page hotel booking platform for modern travelers. It provides a curated hotel discovery experience, date-based availability search, and a streamlined reservation engine — all without payment processing. Reservations are confirmed instantly upon successful availability check.

The platform is built on a microservices architecture: a React SPA front-end communicates through a KrakenD API Gateway to a Node.js/Express Booking Service backed by a MySQL database. Async notifications flow through Kafka. Hotel images are served from MinIO (S3-compatible storage). The existing codebase provides hotel creation, an OpenSearch-powered text search, and a SearchPage UI scaffold; this spec covers the full booking lifecycle and all missing capabilities needed to make RoomHop production-ready.

---

## Glossary

- **Search_Service**: The component responsible for querying OpenSearch and MySQL to return available hotels and room types for a given search criteria.
- **Booking_Service**: The Node.js/Express service that manages reservation creation, cancellation, and retrieval, backed by MySQL.
- **Notification_Service**: The microservice that consumes Kafka events and sends confirmation/cancellation emails and SMS to guests.
- **API_Gateway**: The KrakenD instance that routes, validates, and rate-limits all external HTTP requests to internal services.
- **Inventory_Manager**: The MySQL-level component (using `room_type_inventory`) that tracks available rooms per room type per date using the formula `total_inventory - total_reserved`.
- **Reservation**: A confirmed booking record stored in MySQL linking a guest, hotel, room type, date range, and room count.
- **Idempotency_Key**: A unique client-supplied key (UUID) that prevents duplicate reservations from network retries.
- **Guest**: A registered user of the platform identified by `guest_id`, `first_name`, `last_name`, and `email`.
- **Room_Type**: A category of rooms within a hotel (e.g., Standard, Deluxe, Suite) sharing the same amenities, capacity, and nightly rate.
- **Cancellation_Window**: The period during which a guest may cancel a reservation without penalty, defined as within 3 calendar days of the reservation's `created_at` timestamp.
- **Kafka_Topic**: The Kafka topic `hotel.events.reservations` used for publishing booking lifecycle events.
- **MinIO**: The S3-compatible object storage service serving hotel and room images.
- **SPA**: The React single-page application served at the root URL, providing the entire guest-facing UI.

---

## Requirements

### Requirement 1: Hotel & Room Type Discovery

**User Story:** As a traveler, I want to browse hotels and their available room types, so that I can evaluate options before booking.

#### Acceptance Criteria

1. WHEN a request is made to `GET /v1/search` with `location`, `checkIn`, `checkOut`, and `guests` parameters, THE Search_Service SHALL return a list of hotels with at least one room type that has available inventory for every date in the requested range.
2. WHEN `minPrice` or `maxPrice` query parameters are provided, THE Search_Service SHALL filter room types to only include those whose nightly rate falls within the specified price range on each requested date.
3. WHEN no hotels match the search criteria, THE Search_Service SHALL return an empty results array and an HTTP 200 status code.
4. THE Search_Service SHALL include for each result: `hotel_id`, `name`, `location`, `description`, `room_type_id`, `room_type_name`, `max_occupancy`, `amenities`, `nightly_rate`, and `available_rooms_count`.
5. WHEN the `guests` parameter exceeds the `max_occupancy` of a room type, THE Search_Service SHALL exclude that room type from the results.
6. IF the `checkIn` date is equal to or later than the `checkOut` date, THEN THE Search_Service SHALL return an HTTP 400 status code with a descriptive error message.
7. IF the `checkIn` date is in the past, THEN THE Search_Service SHALL return an HTTP 400 status code with a descriptive error message.
8. WHERE MinIO contains images for a hotel, THE Search_Service SHALL include a `primary_image_url` field in each hotel result.

---

### Requirement 2: Database Schema Migration

**User Story:** As a backend developer, I want the MySQL schema to match the target domain model, so that reservations and inventory can be managed correctly.

#### Acceptance Criteria

1. THE Booking_Service SHALL operate against a MySQL schema that includes the tables: `hotel`, `room_type`, `room`, `room_type_rate`, `room_type_inventory`, `guest`, and `reservation`.
2. THE `reservation` table SHALL contain columns: `reservation_id` (PK), `hotel_id` (FK), `room_type_id` (FK), `guest_id` (FK), `start_date`, `end_date`, `status` (ENUM: `CONFIRMED`, `CANCELLED`), `room_count`, `amount`, `created_at`, `updated_at`.
3. THE `room_type_inventory` table SHALL enforce a unique constraint on `(hotel_id, room_type_id, date)` to prevent duplicate inventory rows.
4. THE `room_type_rate` table SHALL enforce a unique constraint on `(hotel_id, room_type_id, date)` to prevent duplicate rate rows.
5. THE Booking_Service SHALL compute available rooms as `total_inventory - total_reserved` for each `(room_type_id, date)` pair within the requested date range.

---

### Requirement 3: Reservation Creation

**User Story:** As a traveler, I want to book a room type at a hotel for specific dates, so that I have a confirmed place to stay.

#### Acceptance Criteria

1. WHEN a `POST /v1/reservations` request is received with a valid `hotel_id`, `room_type_id`, `guest_id`, `start_date`, `end_date`, and `room_count`, THE Booking_Service SHALL create a reservation with status `CONFIRMED` and return an HTTP 201 status code.
2. WHEN creating a reservation, THE Booking_Service SHALL acquire a row-level lock (`SELECT FOR UPDATE`) on all affected `room_type_inventory` rows for the requested date range before checking availability, to prevent race conditions.
3. WHEN the requested `room_count` is available across all dates in the range, THE Booking_Service SHALL increment `total_reserved` by `room_count` for each affected inventory row within the same database transaction.
4. IF the available inventory (`total_inventory - total_reserved`) for any date in the requested range is less than the requested `room_count`, THEN THE Booking_Service SHALL return an HTTP 409 status code with a descriptive error message and SHALL NOT create a reservation.
5. WHEN a reservation is successfully created, THE Booking_Service SHALL calculate `amount` as the sum of `room_count × nightly_rate` for each date in the range using the `room_type_rate` table.
6. WHEN a valid `Idempotency-Key` header is present, THE Booking_Service SHALL return the existing reservation response if a reservation with that key already exists, instead of creating a duplicate, with an HTTP 200 status code.
7. IF the `start_date` is equal to or later than the `end_date`, THEN THE Booking_Service SHALL return an HTTP 400 status code with a descriptive error message.
8. IF a required field (`hotel_id`, `room_type_id`, `guest_id`, `start_date`, `end_date`, `room_count`) is missing from the request body, THEN THE Booking_Service SHALL return an HTTP 422 status code listing all missing fields.
9. WHEN a reservation is successfully created, THE Booking_Service SHALL publish a `reservation.confirmed` event to the `hotel.events.reservations` Kafka topic.

---

### Requirement 4: Reservation Cancellation

**User Story:** As a traveler, I want to cancel my reservation within the cancellation window, so that I can adjust my plans without penalty.

#### Acceptance Criteria

1. WHEN a `DELETE /v1/reservations/{reservation_id}` request is received and the reservation exists with status `CONFIRMED`, THE Booking_Service SHALL update the reservation status to `CANCELLED` and return an HTTP 200 status code.
2. WHEN a reservation is cancelled, THE Booking_Service SHALL decrement `total_reserved` by the reservation's `room_count` for each inventory row in the reservation's date range within the same database transaction.
3. IF the current date is more than 3 calendar days after the reservation's `created_at` date, THEN THE Booking_Service SHALL return an HTTP 403 status code with a message stating the cancellation window has closed.
4. IF the reservation does not exist, THEN THE Booking_Service SHALL return an HTTP 404 status code.
5. IF the reservation status is already `CANCELLED`, THEN THE Booking_Service SHALL return an HTTP 409 status code with a message indicating the reservation is already cancelled.
6. WHEN a reservation is successfully cancelled, THE Booking_Service SHALL publish a `reservation.cancelled` event to the `hotel.events.reservations` Kafka topic.

---

### Requirement 5: Reservation Retrieval

**User Story:** As a traveler, I want to view my reservations, so that I can track my upcoming and past bookings.

#### Acceptance Criteria

1. WHEN a request is made to `GET /v1/reservations?guest_id={guest_id}`, THE Booking_Service SHALL return all reservations associated with that `guest_id`, ordered by `created_at` descending.
2. WHEN a request is made to `GET /v1/reservations/{reservation_id}`, THE Booking_Service SHALL return the full reservation detail including `reservation_id`, `hotel_id`, `hotel_name`, `room_type_id`, `room_type_name`, `guest_id`, `start_date`, `end_date`, `status`, `room_count`, `amount`, `created_at`, and `updated_at`.
3. IF no reservations exist for the provided `guest_id`, THE Booking_Service SHALL return an empty array and HTTP 200.
4. IF the reservation with `reservation_id` does not exist, THEN THE Booking_Service SHALL return an HTTP 404 status code.
5. WHEN a `guest_id` query parameter is not provided to `GET /v1/reservations`, THE Booking_Service SHALL return an HTTP 400 status code with a descriptive error message.

---

### Requirement 6: Async Notifications

**User Story:** As a traveler, I want to receive an email and SMS confirmation when my booking status changes, so that I have a record of my reservation.

#### Acceptance Criteria

1. WHEN the Notification_Service consumes a `reservation.confirmed` event from the `hotel.events.reservations` Kafka topic, THE Notification_Service SHALL send a confirmation email to the guest's registered email address.
2. WHEN the Notification_Service consumes a `reservation.cancelled` event from the `hotel.events.reservations` Kafka topic, THE Notification_Service SHALL send a cancellation notification email to the guest's registered email address.
3. IF the Notification_Service fails to send a notification, THE Notification_Service SHALL retry the send operation up to 3 times before marking the notification as failed.
4. THE Notification_Service SHALL process notification events without blocking the Booking_Service response to the guest.
5. WHEN a notification is permanently failed after all retries, THE Notification_Service SHALL log the failed event with the `guest_id`, `reservation_id`, and error reason for operational visibility.

---

### Requirement 7: API Gateway Configuration

**User Story:** As a platform operator, I want all external API traffic to route through the API Gateway, so that routing, rate limiting, and CORS are managed centrally.

#### Acceptance Criteria

1. THE API_Gateway SHALL route `GET /v1/search` requests to the Search_Service.
2. THE API_Gateway SHALL route `POST /v1/reservations` requests to the Booking_Service.
3. THE API_Gateway SHALL route `DELETE /v1/reservations/{id}` requests to the Booking_Service.
4. THE API_Gateway SHALL route `GET /v1/reservations` requests to the Booking_Service.
5. THE API_Gateway SHALL route `GET /v1/reservations/{id}` requests to the Booking_Service.
6. THE API_Gateway SHALL enforce a timeout of 3 seconds on all upstream requests.
7. WHEN a request exceeds the 3-second timeout, THE API_Gateway SHALL return an HTTP 504 status code to the client.

---

### Requirement 8: React SPA — Search & Results

**User Story:** As a traveler, I want a responsive, polished search interface, so that I can easily find and compare hotel options from any device.

#### Acceptance Criteria

1. THE SPA SHALL provide a search widget with fields for `location`, `check-in date`, `check-out date`, `number of guests`, and optional `min/max price` filters.
2. WHEN the user submits a search, THE SPA SHALL call `GET /v1/search` via the API_Gateway and display the results in a hotel card grid.
3. WHILE a search request is in progress, THE SPA SHALL display skeleton loader placeholders in place of hotel cards.
4. WHEN a search returns no results, THE SPA SHALL display an informational message instead of an empty grid.
5. THE SPA SHALL be responsive with breakpoints at 768px (mobile/tablet transition) and 1024px (tablet/desktop transition).
6. THE SPA SHALL use the brand color palette: Rose `#F43F5E`, Coral `#FB923C`, and Background `#FFF1F2`.
7. WHEN the user scrolls past the navigation bar, THE SPA SHALL apply a blur-backdrop effect to the fixed navigation bar.
8. WHEN a gallery image is clicked, THE SPA SHALL display the image in a full-screen lightbox overlay.

---

### Requirement 9: React SPA — Booking Flow

**User Story:** As a traveler, I want to select a room and confirm a booking directly from the search results, so that I can reserve a stay without leaving the page.

#### Acceptance Criteria

1. WHEN a traveler clicks a hotel card, THE SPA SHALL display a room type selection panel showing all available room types with their nightly rate, amenities, and occupancy.
2. WHEN a traveler selects a room type and confirms the booking, THE SPA SHALL call `POST /v1/reservations` via the API_Gateway with the selected details.
3. WHILE the booking request is in progress, THE SPA SHALL display a loading indicator and disable the confirm button to prevent duplicate submissions.
4. WHEN a `POST /v1/reservations` call succeeds, THE SPA SHALL display a booking confirmation summary showing `reservation_id`, `hotel_name`, `room_type_name`, `start_date`, `end_date`, `room_count`, and `amount`.
5. IF the `POST /v1/reservations` call returns HTTP 409 (no availability), THE SPA SHALL display an inline error message indicating the room is no longer available and prompt the traveler to modify the search.
6. THE SPA SHALL generate a UUID `Idempotency-Key` header for each booking submission to prevent duplicate reservations on retry.
7. WHEN a traveler confirms a booking, THE SPA SHALL store the `reservation_id` in browser session storage so the confirmation can be retrieved if the page is refreshed.

---

### Requirement 10: Image Storage and Serving

**User Story:** As a platform operator, I want hotel and room images stored and served from MinIO, so that images load reliably without depending on external CDNs.

#### Acceptance Criteria

1. THE Booking_Service SHALL store hotel and room images as objects in a MinIO bucket named `hotels`.
2. WHEN a hotel image is requested, THE Search_Service SHALL construct the image URL using the MinIO base URL and the stored object path.
3. IF a hotel has no image stored in MinIO, THE Search_Service SHALL return `null` for the `primary_image_url` field rather than a broken URL.
4. THE MinIO bucket `hotels` SHALL be configured with public read access so that the SPA can load images directly without pre-signed URL generation per request.
