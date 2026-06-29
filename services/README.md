# RoomHop — AWS Services

This directory contains the application services adapted for AWS deployment.

## Architecture

```
┌─────────────────┐     ┌──────────────────────┐
│  search-service │     │  reservation-service  │
│   (ECS Fargate) │     │    (ECS Fargate)      │
└────────┬────────┘     └──────────┬────────────┘
         │                         │
         │  ┌──────────────────┐   │
         └──│  Aurora MySQL     │───┘
            │  (Secrets Mgr)   │
            └──────────────────┘
                                   │
                          ┌────────▼─────────┐
                          │   EventBridge     │
                          │  (roomhop-events) │
                          └────────┬─────────┘
                       ┌───────────┼───────────┐
                       ▼                       ▼
              ┌────────────────┐     ┌────────────────┐
              │  SQS Notif Q   │     │  SQS Analytics │
              └───────┬────────┘     └───────┬────────┘
                      ▼                      ▼
           ┌──────────────────┐   ┌──────────────────┐
           │ notification-    │   │ analytics-       │
           │ handler (Lambda) │   │ handler (Lambda) │
           └──────────────────┘   └──────────────────┘
                      │                      │
                      ▼                      ▼
              ┌──────────────┐     ┌──────────────┐
              │   AWS SES    │     │   S3 Bucket  │
              └──────────────┘     └──────────────┘
```

## Services

### search-service (ECS Fargate)

Handles hotel availability searches. Reads from Aurora MySQL and returns results with CloudFront CDN image URLs.

**Endpoints:**
- `GET /health` — ALB health check
- `GET /v1/search?location=&checkIn=&checkOut=&guests=` — Hotel availability search

### reservation-service (ECS Fargate)

Handles reservation CRUD operations. Uses transactions for inventory management and publishes events to EventBridge.

**Endpoints:**
- `GET /health` — ALB health check
- `POST /v1/reservations` — Create a reservation
- `GET /v1/reservations?guest_id=` — List guest reservations
- `GET /v1/reservations/:id` — Get reservation detail
- `DELETE /v1/reservations/:id` — Cancel a reservation

### notification-handler (Lambda)

Triggered by SQS messages from EventBridge. Sends booking confirmation/cancellation emails via SES.

### analytics-handler (Lambda)

Triggered by SQS messages from EventBridge. Writes JSON analytics records to S3 partitioned by date for Athena queries.

---

## Building Docker Images

### Prerequisites

- Docker installed
- AWS CLI configured with ECR access

### Build

```bash
# Search service
cd services/search-service
docker build -t roomhop-search-service:latest .

# Reservation service
cd services/reservation-service
docker build -t roomhop-reservation-service:latest .
```

### Push to ECR

```bash
# Authenticate Docker with ECR
aws ecr get-login-password --region eu-west-1 | docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.eu-west-1.amazonaws.com

# Tag and push search service
docker tag roomhop-search-service:latest <ACCOUNT_ID>.dkr.ecr.eu-west-1.amazonaws.com/roomhop-search-service:latest
docker push <ACCOUNT_ID>.dkr.ecr.eu-west-1.amazonaws.com/roomhop-search-service:latest

# Tag and push reservation service
docker tag roomhop-reservation-service:latest <ACCOUNT_ID>.dkr.ecr.eu-west-1.amazonaws.com/roomhop-reservation-service:latest
docker push <ACCOUNT_ID>.dkr.ecr.eu-west-1.amazonaws.com/roomhop-reservation-service:latest
```

---

## Environment Variables

### search-service

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP listen port | `3000` |
| `AWS_REGION` | AWS region | `eu-west-1` |
| `DB_SECRET_ARN` | Secrets Manager ARN for DB credentials | — (required) |
| `DB_NAME` | MySQL database name | `hotel_db` |
| `CDN_BASE_URL` | CloudFront distribution URL for images | `https://d1234.cloudfront.net` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | `*` |
| `SERVICE_NAME` | Logger service identifier | `search-service` |
| `NODE_ENV` | Environment (production/development) | — |
| `LOG_LEVEL` | Winston log level | `info` (prod) / `debug` (dev) |

### reservation-service

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | HTTP listen port | `3000` |
| `AWS_REGION` | AWS region | `eu-west-1` |
| `DB_SECRET_ARN` | Secrets Manager ARN for DB credentials | — (required) |
| `DB_NAME` | MySQL database name | `hotel_db` |
| `EVENT_BUS_NAME` | EventBridge custom bus name | `roomhop-events` |
| `ALLOWED_ORIGINS` | Comma-separated CORS origins | `*` |
| `SERVICE_NAME` | Logger service identifier | `reservation-service` |
| `NODE_ENV` | Environment (production/development) | — |
| `LOG_LEVEL` | Winston log level | `info` (prod) / `debug` (dev) |

### notification-handler (Lambda)

| Variable | Description | Default |
|----------|-------------|---------|
| `AWS_REGION` | AWS region | `eu-west-1` |
| `SENDER_EMAIL` | Verified SES sender address | `noreply@roomhop.com` |

### analytics-handler (Lambda)

| Variable | Description | Default |
|----------|-------------|---------|
| `AWS_REGION` | AWS region | `eu-west-1` |
| `ANALYTICS_BUCKET` | S3 bucket for analytics data | — (required) |

---

## Local Development with Docker

You can test the ECS services locally using Docker:

```bash
# 1. Start a local MySQL instance
docker run -d --name mysql-local \
  -e MYSQL_ROOT_PASSWORD=rootpassword \
  -e MYSQL_DATABASE=hotel_db \
  -p 3306:3306 \
  mysql:8.0

# 2. Build the search service
cd services/search-service
docker build -t roomhop-search-service:local .

# 3. Run the search service (uses local DB secret simulation)
#    For local testing, override db.js or set DB_SECRET_ARN to a local Secrets Manager
docker run -d --name search-local \
  -p 3001:3000 \
  -e AWS_REGION=eu-west-1 \
  -e DB_SECRET_ARN=arn:aws:secretsmanager:eu-west-1:123456789012:secret:roomhop/db \
  -e DB_NAME=hotel_db \
  -e CDN_BASE_URL=http://localhost:9000 \
  -e NODE_ENV=development \
  roomhop-search-service:local

# 4. Build and run the reservation service
cd ../reservation-service
docker build -t roomhop-reservation-service:local .

docker run -d --name reservation-local \
  -p 3002:3000 \
  -e AWS_REGION=eu-west-1 \
  -e DB_SECRET_ARN=arn:aws:secretsmanager:eu-west-1:123456789012:secret:roomhop/db \
  -e DB_NAME=hotel_db \
  -e EVENT_BUS_NAME=roomhop-events \
  -e NODE_ENV=development \
  roomhop-reservation-service:local

# 5. Test health endpoints
curl http://localhost:3001/health
curl http://localhost:3002/health
```

> **Note:** For full local testing with Secrets Manager, use [LocalStack](https://localstack.cloud/) or override the `db.js` module to use hardcoded credentials in development mode.

---

## Lambda Deployment

Lambda handlers are deployed via CDK (see `infra/lib/events-stack.ts`). For manual deployment or testing:

```bash
# Package notification handler
cd services/lambda/notification-handler
npm install
zip -r notification-handler.zip .

# Package analytics handler
cd ../analytics-handler
npm install
zip -r analytics-handler.zip .
```

Upload the ZIP files to Lambda via the AWS Console or CLI:

```bash
aws lambda update-function-code \
  --function-name roomhop-notification-handler \
  --zip-file fileb://notification-handler.zip

aws lambda update-function-code \
  --function-name roomhop-analytics-handler \
  --zip-file fileb://analytics-handler.zip
```
