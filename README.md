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
| Analytics Service | `analytics-service/` | — (consumer) | Node.js + KafkaJS + Parquet |
| API Gateway | `krakend.json` | 8080 | KrakenD |
| Database | Docker | 3306 | MySQL 8.0 |
| Message Broker | Docker | 9022 | Apache Kafka (KRaft) |
| Object Storage | Docker | 9000 | MinIO |
| SQL Engine | Docker | 8083 | Trino 435 |
| BI Dashboards | Docker | 3001 | Metabase |

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
├── analytics-service/      # BI & Analytics — Kafka to Parquet pipeline
│   └── src/
│       ├── consumer.js     # Kafka consumer entry point
│       ├── config.js       # Environment-based configuration
│       ├── logger.js       # Winston structured logger
│       ├── writers/        # Parquet file writers
│       ├── transformers/   # Event routing and transformation
│       └── storage/        # MinIO S3 client
├── trino/                  # Trino SQL engine configuration
│   ├── catalog/            # Hive connector (MinIO → Parquet)
│   └── etc/                # Node and JVM config
├── database/               # SQL migrations and seed data
├── docker-compose.yaml     # Infrastructure (MySQL, Kafka, MinIO, Trino, Metabase)
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

## BI & Analytics Platform

RoomHop includes a complete BI & Analytics pipeline that transforms real-time reservation events into queryable data for dashboards and business intelligence.

### Analytics Architecture

```
Kafka (hotel.events.reservations) → Analytics Service → Parquet files → MinIO bucket
                                                                            ↓
                                                                         Trino (SQL)
                                                                            ↓
                                                                        Metabase (Dashboards)
```

| Component | Port | Purpose |
|-----------|------|---------|
| Analytics Service | — (consumer) | Kafka → Parquet pipeline |
| Trino | 8083 | Distributed SQL over Parquet in MinIO |
| Metabase | 3001 | BI dashboards and visualization |

### How It Works

1. **Kafka Consumer** — The analytics service subscribes to `hotel.events.reservations` and receives every confirmed/cancelled reservation event
2. **Event Transformation** — Raw events are normalized into a flat analytical schema with partition columns (year, month)
3. **Parquet Batch Writing** — Events are buffered (batch of 10 or every 30 seconds) and written as Apache Parquet files to MinIO
4. **Hive-Partitioned Storage** — Files are stored at `reservations/year=YYYY/month=MM/<uuid>.parquet` for efficient time-range pruning
5. **Trino SQL** — Trino reads Parquet files directly from MinIO using the Hive connector with column pruning and predicate pushdown
6. **Metabase Dashboards** — Connects to Trino for visual KPI dashboards

### Why Apache Parquet?

| Feature | Benefit |
|---------|---------|
| Columnar format | Only reads columns needed for a query (column pruning) |
| Compression | 5-10x smaller than JSON/CSV |
| Typed schema | Schema-embedded, no parsing ambiguity |
| Predicate pushdown | Trino skips row groups based on min/max stats |
| Industry standard | Works with Spark, Trino, Athena, BigQuery, Databricks |

### How Trino Works

Trino is a **distributed SQL query engine** that never stores data — it's pure compute:

- **Column Pruning** — Only reads the Parquet columns referenced in your SELECT clause
- **Predicate Pushdown** — Filters on partitioned columns (year/month) skip entire files
- **Row Group Statistics** — Each Parquet row group stores min/max for each column; Trino skips groups that can't contain matching rows
- **Distributed Execution** — Queries are split into stages and executed in parallel across workers
- **Memory Model** — Spills to disk when memory pressure exceeds thresholds, preventing OOM crashes

### Starting the Analytics Service

```bash
# 1. Ensure Docker infrastructure is running
docker-compose up -d

# 2. Install dependencies
cd analytics-service
npm install

# 3. Start the consumer
node src/consumer.js
```

You should see:
```
Analytics bucket exists { bucket: 'hotel-analytic-roomhop-76700' }
Analytics consumer connected { topic: 'hotel.events.reservations', groupId: 'analytics-service' }
```

### Accessing Trino (SQL)

Once `docker-compose up -d` includes Trino:

```bash
# Connect via Trino CLI (or any JDBC client at localhost:8083)
docker exec -it hotel-trino trino

# Example: list catalogs
SHOW CATALOGS;

# Example: query reservation analytics
SELECT hotel_name, COUNT(*) as bookings, SUM(amount) as revenue
FROM minio.default.reservations
WHERE year = 2026 AND month = 6
GROUP BY hotel_name
ORDER BY revenue DESC;
```

### Accessing Metabase (Dashboards)

1. Open **http://localhost:3001** in your browser
2. Complete the initial setup wizard
3. Add a **Trino** database connection:
   - Host: `trino` (Docker network name)
   - Port: `8083`
   - Database: `minio`
   - Schema: `default`
4. Create questions and dashboards using the reservation analytics data

### Example KPI Queries (Trino SQL)

```sql
-- Daily booking volume
SELECT booking_date, COUNT(*) AS bookings
FROM minio.default.reservations
WHERE event_type = 'reservation.confirmed'
GROUP BY booking_date
ORDER BY booking_date DESC
LIMIT 30;

-- Revenue by hotel (monthly)
SELECT hotel_name, year, month, SUM(amount) AS total_revenue, COUNT(*) AS total_bookings
FROM minio.default.reservations
WHERE event_type = 'reservation.confirmed'
GROUP BY hotel_name, year, month
ORDER BY year DESC, month DESC, total_revenue DESC;

-- Cancellation rate by hotel
SELECT hotel_name,
       COUNT(CASE WHEN event_type = 'reservation.confirmed' THEN 1 END) AS confirmed,
       COUNT(CASE WHEN event_type = 'reservation.cancelled' THEN 1 END) AS cancelled,
       ROUND(
         COUNT(CASE WHEN event_type = 'reservation.cancelled' THEN 1 END) * 100.0 /
         NULLIF(COUNT(*), 0), 2
       ) AS cancellation_rate_pct
FROM minio.default.reservations
GROUP BY hotel_name
ORDER BY cancellation_rate_pct DESC;

-- Average stay duration
SELECT hotel_name, AVG(DATE_DIFF('day', DATE(check_in), DATE(check_out))) AS avg_nights
FROM minio.default.reservations
WHERE event_type = 'reservation.confirmed' AND check_in IS NOT NULL AND check_out IS NOT NULL
GROUP BY hotel_name;

-- Top room types by revenue
SELECT room_type, COUNT(*) AS bookings, SUM(amount) AS revenue
FROM minio.default.reservations
WHERE event_type = 'reservation.confirmed' AND room_type IS NOT NULL
GROUP BY room_type
ORDER BY revenue DESC;
```

### Analytics Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KAFKA_BROKER` | `localhost:9022` | Kafka broker address |
| `MINIO_ENDPOINT` | `localhost` | MinIO host |
| `MINIO_PORT` | `9000` | MinIO port |
| `MINIO_ACCESS_KEY` | `minioadmin` | MinIO access key |
| `MINIO_SECRET_KEY` | `miniopassword` | MinIO secret key |
| `LOG_LEVEL` | `info` | Minimum log level |

## License

Private project — not for distribution.


## Structured Logging

Both backend services use **Winston** for structured JSON logging with automatic CloudWatch integration.

### Local Development

Logs appear in the console with colorized, human-readable format:
```
15:04:22.123 [info] [hotel-api] Request received {"requestId":"abc-123","method":"GET","path":"/v1/search"}
```

JSON logs are also written to `logs/app.log` in each service directory.

### AWS Deployment (CloudWatch)

Set these environment variables to enable CloudWatch logging:

```bash
export NODE_ENV=production
export AWS_REGION=eu-west-1          # Your AWS region
export LOG_GROUP=roomhop/hotel-api   # Optional: custom log group name
export LOG_LEVEL=info                # Optional: minimum log level
```

**Required IAM Permissions:**
```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Action": [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
      "logs:DescribeLogStreams"
    ],
    "Resource": "arn:aws:logs:*:*:log-group:roomhop/*"
  }]
}
```

### Testing Logging Locally

1. Start the API: `cd hotel-api && node src/app.js`
2. Make a request: `curl http://localhost:3000/v1/search?location=Paris&checkIn=2026-07-15&checkOut=2026-07-20&guests=1`
3. Check console output — you'll see structured request/response logs
4. Check `hotel-api/logs/app.log` for JSON-formatted logs

To simulate production logging format locally:
```bash
NODE_ENV=production node src/app.js
```

### Log Levels

| Level | Usage |
|-------|-------|
| error | Unhandled exceptions, DB failures, Kafka disconnects |
| warn  | Validation failures, cancellation policy violations |
| info  | Request lifecycle, reservations created/cancelled, Kafka events |
| debug | SQL queries, event payloads, detailed flow tracing |
