# RoomHop — Hotel Booking Platform

RoomHop is a hotel booking platform built as a hands-on learning project. It started as a fully local Docker-based stack and was progressively industrialized into a production-grade AWS cloud deployment using Infrastructure as Code (CDK).

---

## Project Journey

### Phase 1 — Local Development (Docker)

The platform was first built and validated entirely on a local machine using Docker Compose. This phase focused on understanding the application architecture, service interactions, and data flows before touching any cloud infrastructure.

```
Browser (React SPA)  →  KrakenD Gateway (port 8080)  →  Booking API (port 3000)  →  MySQL
                                                      ↓
                                                    Kafka  →  Notification Service

Hotel images served from MinIO (S3-compatible, port 9000)
```

| Service | Location | Port | Tech |
|---------|----------|------|------|
| React SPA | `hotel-ui/` | 5173 | Vite + React + React Router |
| Booking API | `hotel-api/` | 3000 | Node.js + Express + mysql2 |
| Notification Service | `notification-service/` | — | Node.js + KafkaJS |
| Analytics Service | `analytics-service/` | — | Node.js + KafkaJS + Parquet |
| API Gateway | `krakend.json` | 8080 | KrakenD |
| Database | Docker | 3306 | MySQL 8.0 |
| Message Broker | Docker | 9022 | Apache Kafka (KRaft) |
| Object Storage | Docker | 9000 | MinIO |
| BI Dashboards | Docker | 3001 | Metabase |

### Phase 2 — AWS Industrialization (CDK)

Once the application was validated locally, the entire stack was re-architected and deployed to AWS using CDK v2 (TypeScript). Local Docker services were replaced with managed AWS equivalents:

| Local | AWS Equivalent |
|-------|---------------|
| KrakenD API Gateway | Amazon API Gateway HTTP API |
| MySQL (Docker) | Amazon RDS MySQL 8.0 |
| Kafka (Docker) | Amazon EventBridge + SQS |
| MinIO (Docker) | Amazon S3 + CloudFront |
| Node.js processes | ECS Fargate containers |
| Notification Service | AWS Lambda + SES |
| Analytics Service | AWS Lambda + S3 + Athena |
| Manual auth | Amazon Cognito |

The AWS deployment lives in `infra/` and follows the AWS Well-Architected Framework across all 6 pillars.

---

## AWS Architecture

```
Browser
  ├── Cognito (JWT Authentication)
  └── CloudFront (WAF) → S3 (React SPA + images)
           │
           │ HTTPS + JWT
           ▼
  API Gateway HTTP API (JWT Authorizer)
           │
           │ VPC Link (private)
           ▼
  ┌─────────────────────────────────────────────────────┐
  │  VPC — Private Isolated Subnets (no NAT Gateway)    │
  │                                                      │
  │  Internal ALB                                        │
  │    /v1/search*       → Search Service (ECS Fargate)  │
  │    /v1/reservations* → Reservation Service (Fargate) │
  │         │  Auto Scaling (min 1 / max 4 tasks)        │
  │         │  X-Ray Daemon sidecar                      │
  │         ▼                                            │
  │    RDS MySQL 8.0 (Secrets Manager)                   │
  │         │                                            │
  │         ▼ (via VPC Endpoint)                         │
  │    EventBridge → SQS Notification → Lambda → SES    │
  │                → SQS Analytics    → Lambda → S3     │
  │                                                      │
  │  VPC Interface Endpoints (no traffic leaves AWS)     │
  └─────────────────────────────────────────────────────┘
           │
           ▼
  S3 Analytics Bucket → Athena (Glue catalog)
  CloudTrail → S3 + CloudWatch Logs
  IAM Access Analyzer (account-wide)
```

### CDK Stacks

| Stack | What it deploys |
|-------|----------------|
| `RoomHop-Network` | VPC, private subnets, 8 VPC Interface Endpoints, security groups |
| `RoomHop-Database` | RDS MySQL t3.medium, Secrets Manager, migration Lambda |
| `RoomHop-Compute` | ECS Fargate (2 services), internal ALB, ECR repos, Auto Scaling, X-Ray |
| `RoomHop-Auth` | Cognito User Pool + App Client |
| `RoomHop-Api` | API Gateway HTTP API, VPC Link, JWT Authorizer |
| `RoomHop-Frontend` | S3 (website + images), CloudFront, WAFv2 (rate limit, SQLi, XSS) |
| `RoomHop-Events` | EventBridge bus, SQS queues + DLQs, notification Lambda, analytics Lambda |
| `RoomHop-Analytics` | Glue database + table, Athena workgroup, S3 results bucket |
| `RoomHop-Observability` | CloudTrail, IAM Access Analyzer |

### Key Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| No NAT Gateway | VPC Endpoints for all AWS service access — saves ~$32/month |
| Private isolated subnets only | Maximum network isolation — no public subnets |
| API Gateway + VPC Link | ALB has no public IP, traffic stays on AWS backbone |
| ECS Fargate | No EC2 to manage, pay only when tasks run |
| EventBridge + SQS | Replaces Kafka — fully serverless, no brokers to manage |
| Auto Scaling on ECS | min 1 / max 4 tasks, scales on CPU (60%) and memory (70%) |
| X-Ray tracing | Daemon sidecar on every Fargate task, 10% sampling rate |
| CloudTrail | Full audit log of all API calls across the account |
| IAM Access Analyzer | Continuously flags overly permissive resource policies |

---

## Features

- **Hotel Search** — Search by city, dates, guests, price range, and amenities
- **Grouped Results** — Hotels with hero images, room types listed per hotel
- **Room Type Filtering** — Filter by amenities (WiFi, Pool, City View, etc.)
- **Full Booking Flow** — Select room → fill guest details → view price breakdown → confirm
- **Reservation Management** — View upcoming/past/cancelled trips, cancel with 3-day policy
- **Async Notifications** — Email confirmations and cancellations via SES
- **Responsive Design** — Mobile-first with modern silver/teal UI

---

## Running Locally (Phase 1)

### Prerequisites

- Node.js 18+
- Docker Desktop
- npm

### 1. Start Docker infrastructure

```bash
docker-compose up -d
```

Wait ~15 seconds for all services to be healthy.

### 2. Create Kafka topic

```bash
docker exec hotel-kafka /opt/kafka/bin/kafka-topics.sh --create --topic hotel.events.reservations --bootstrap-server localhost:9022 --partitions 1 --replication-factor 1 --if-not-exists
```

### 3. Run database migrations

```bash
# Windows (PowerShell)
Get-Content database/migration_v2.sql -Raw | docker exec -i hotel-mysql mysql -u root -prootpassword hotel_db
Get-Content database/seed_v2.sql -Raw | docker exec -i hotel-mysql mysql -u root -prootpassword hotel_db

# Mac/Linux
docker exec -i hotel-mysql mysql -u root -prootpassword hotel_db < database/migration_v2.sql
docker exec -i hotel-mysql mysql -u root -prootpassword hotel_db < database/seed_v2.sql
```

### 4. Install dependencies and start services

```bash
cd hotel-api && npm install && node src/app.js
cd ../notification-service && npm install && node src/consumer.js
cd ../hotel-ui && npm install && npm run dev
```

Open **http://localhost:5173** in your browser.

### Local Admin UIs

| Tool | URL | Purpose |
|------|-----|---------|
| Adminer (MySQL) | http://localhost:8081 | Database management |
| AKHQ (Kafka) | http://localhost:8082 | Kafka topics & messages |
| MinIO Console | http://localhost:9001 | Object storage |
| Metabase | http://localhost:3001 | BI dashboards |

---

## Deploying to AWS (Phase 2)

See [`infra/README.md`](infra/README.md) for the full step-by-step AWS deployment guide including:
- CDK bootstrap and stack deployment order
- Docker image build and ECR push
- React frontend build and S3 upload
- SES email verification
- Teardown instructions

### Quick deploy summary

```bash
cd infra
npm install
npx cdk bootstrap aws://YOUR_ACCOUNT_ID/us-east-1
npx cdk deploy --all --require-approval never
```

---

## Running Tests

```bash
# API property tests
cd hotel-api && npm test

# Notification service tests
cd notification-service && npm test

# Frontend tests
cd hotel-ui && npm run test
```

---

## Project Structure

```
Hotel_Management_system/
├── hotel-api/              # Express.js Booking API
├── hotel-ui/               # React SPA (Vite)
├── notification-service/   # Kafka/SQS consumer — email notifications
├── analytics-service/      # Kafka consumer — Parquet archival (local)
├── services/               # AWS Lambda functions (notification, analytics, migration)
│   └── lambda/
│       ├── notification-handler/
│       ├── analytics-handler/
│       └── db-migration/
├── infra/                  # AWS CDK v2 (TypeScript) — all cloud infrastructure
│   ├── bin/app.ts          # CDK app entry point — all stacks wired here
│   └── lib/
│       ├── network-stack.ts
│       ├── database-stack.ts
│       ├── compute-stack.ts
│       ├── auth-stack.ts
│       ├── api-stack.ts
│       ├── frontend-stack.ts
│       ├── events-stack.ts
│       ├── analytics-stack.ts
│       └── observability-stack.ts
├── database/               # SQL migrations and seed data
├── docker-compose.yaml     # Local infrastructure
└── krakend.json            # Local API Gateway config
```

---

## Well-Architected Coverage

| Pillar | What's implemented |
|--------|-------------------|
| Operational Excellence | Structured logging (Winston), CloudTrail, X-Ray tracing, ECS Container Insights |
| Security | WAF, Cognito JWT auth, Secrets Manager, VPC Endpoints, IAM Access Analyzer, no public subnets |
| Reliability | ECS Auto Scaling, SQS DLQs, RDS automated backups, health checks |
| Performance Efficiency | CloudFront CDN, ECS Fargate right-sizing, Athena for analytics queries |
| Cost Optimization | No NAT Gateway, Fargate pay-per-use, S3 lifecycle rules, Glacier archival |
| Sustainability | No always-on EC2, event-driven Lambda, S3 Intelligent Tiering ready |

---

## License

Private project — not for distribution.
