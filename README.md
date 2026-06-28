# RoomHop — Hotel Booking Platform

RoomHop is a next-generation hotel booking platform designed for modern travelers. It provides a curated hotel discovery experience with date-based availability search, a streamlined reservation engine, and async email notifications — all without payment processing. Reservations are confirmed instantly upon successful availability check.

## Architecture

```
Browser (React SPA)  →  KrakenD Gateway (port 8080)  →  Booking API (port 3000)  →  MySQL
                                                      ↓
                                                    Kafka  →  Notification Service
                                                      
Hotel images served from MinIO (S3-compatible, port 9000)
```

| Service | Location | Port | Tech |
|---------|----------|------|------|
| React SPA | `hotel-ui/` | 5173 (dev) | Vite + React + React Router |
| Booking API | `hotel-api/` | 3000 | Node.js + Express + mysql2 |
| Notification Service | `notification-service/` | — (consumer) | Node.js + KafkaJS |
| API Gateway | `krakend.json` | 8080 | KrakenD |
| Database | Docker | 3306 | MySQL 8.0 |
| Message Broker | Docker | 9022 | Apache Kafka (KRaft) |
| Object Storage | Docker | 9000 | MinIO |

## Features

- **Hotel Search** — Search by city, dates, guests, price range, and amenities
- **Grouped Results** — Hotels displayed with hero images, room types listed per hotel
- **Room Type Filtering** — Filter by amenities (WiFi, Pool, City View, etc.)
- **Full Booking Flow** — Select room → fill guest details → view price breakdown → confirm
- **Reservation Management** — View upcoming/past/cancelled trips, cancel with 3-day policy
- **Async Notifications** — Kafka-powered confirmation and cancellation events
- **Responsive Design** — Mobile-first with modern silver/teal UI

## Prerequisites

- **Node.js** 18+ (for the API and notification service)
- **Docker Desktop** (for MySQL, Kafka, MinIO, KrakenD)
- **npm** (comes with Node.js)

## Quick Start

### 1. Start Docker infrastructure

```bash
docker-compose up -d
```

This starts MySQL, Kafka, MinIO, KrakenD, Redis, OpenSearch, and admin UIs.

Wait ~15 seconds for all services to be healthy.

### 2. Create Kafka topic

```bash
docker exec hotel-kafka /opt/kafka/bin/kafka-topics.sh --create --topic hotel.events.reservations --bootstrap-server localhost:9022 --partitions 1 --replication-factor 1 --if-not-exists
```

### 3. Run database migrations

```bash
# On Windows (PowerShell):
Get-Content database/migration_v2.sql -Raw | docker exec -i hotel-mysql mysql -u root -prootpassword hotel_db
Get-Content database/seed_v2.sql -Raw | docker exec -i hotel-mysql mysql -u root -prootpassword hotel_db

# On Mac/Linux:
docker exec -i hotel-mysql mysql -u root -prootpassword hotel_db < database/migration_v2.sql
docker exec -i hotel-mysql mysql -u root -prootpassword hotel_db < database/seed_v2.sql
```

### 4. Install dependencies

```bash
# API
cd hotel-api
npm install

# Notification Service
cd ../notification-service
npm install

# Frontend
cd ../hotel-ui
npm install
```

### 5. Start the Booking API

```bash
cd hotel-api
node src/app.js
```

You should see:
```
🚀 Hotel API running on port 3000
[kafkaProducer] Connected to Kafka broker at localhost:9022
```

### 6. Start the Notification Service

Open a new terminal:
```bash
cd notification-service
node src/consumer.js
```

You should see it join the Kafka consumer group.

### 7. Start the Frontend

Open a new terminal:
```bash
cd hotel-ui
npm run dev
```

You should see:
```
➜  Local:   http://localhost:5173/
```

### 8. Open the website

Go to **http://localhost:5173/** in your browser.

## Usage

1. **Home page** — Browse the landing page, then use the search form to find hotels
2. **Search** — Enter city (e.g. "Paris"), dates, and number of rooms needed → click "Search hotels"
3. **Results** — View grouped hotel results, filter by amenities, click "Reserve" on a room type
4. **Booking** — Fill guest details (name, email, phone, DOB) → confirm booking
5. **My Reservations** — Click "My Reservations" in navbar → enter Guest ID → view/cancel trips

## Admin UIs

| Tool | URL | Purpose |
|------|-----|---------|
| Adminer (MySQL) | http://localhost:8081 | Database management |
| AKHQ (Kafka) | http://localhost:8082 | Kafka topics & messages |
| MinIO Console | http://localhost:9001 | Object storage (images) |

**MinIO credentials:** `minioadmin` / `miniopassword`

## Hotel Images in MinIO

Hotel and room type images are stored in the `hotels` bucket in MinIO:
- Hotel images: `hotels/<filename>.png` (e.g. `hotel_beaux_arts.png`)
- Room type images: `hotels/room_type/room_type_<id>.png`
- Placeholder images: `hotels/placeholder_image/<name>.jpg`

Upload images via MinIO Console at http://localhost:9001.

## Running Tests

```bash
# API property tests
cd hotel-api
npm test

# Notification service tests
cd notification-service
npm test

# Frontend tests
cd hotel-ui
npm run test
```

## Project Structure

```
Hotel_Management_system/
├── hotel-api/              # Express.js Booking API
│   ├── src/
│   │   ├── app.js          # Express app entry point
│   │   ├── db.js           # MySQL connection pool
│   │   ├── routes/v1/      # API routes (search, reservations)
│   │   ├── services/       # Business logic (reservation, kafka)
│   │   └── middleware/     # Request validation
│   └── __tests__/          # Property-based tests (fast-check)
├── hotel-ui/               # React SPA
│   └── src/
│       ├── pages/          # HomePage, SearchResultsPage, BookingPage, ReservationsPage
│       ├── components/     # Navbar, Footer, HotelCard, SkeletonCard, etc.
│       ├── hooks/          # useSearch, useBooking
│       └── api/            # API client (fetch wrapper)
├── notification-service/   # Kafka consumer for email notifications
├── database/               # SQL migrations and seed data
├── docker-compose.yaml     # Infrastructure (MySQL, Kafka, MinIO, etc.)
└── krakend.json            # API Gateway configuration
```

## Environment Variables

The API uses these environment variables (with defaults):

| Variable | Default | Description |
|----------|---------|-------------|
| `KAFKA_BROKER` | `localhost:9022` | Kafka broker address |
| `MINIO_BASE` | `http://localhost:9000` | MinIO base URL for images |

## Stopping Everything

```bash
# Stop Docker services
docker-compose down

# Stop Node processes (Ctrl+C in each terminal)
```

## License

Private project — not for distribution.
