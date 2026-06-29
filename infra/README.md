# RoomHop — AWS Cloud Deployment (Iteration 1)

## Overview

This is the AWS production deployment of the RoomHop Hotel Booking Platform using AWS CDK v2 (TypeScript). This first iteration deploys the core booking system **without** OpenSearch and DMS — the search service queries MySQL directly.

### What's Deployed

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser                                                              │
│    ├── Cognito (JWT Authentication)                                   │
│    └── CloudFront (WAF) → S3 Website + S3 Hotel Images               │
└──────────────────┬───────────────────────────────────────────────────┘
                   │ HTTPS + JWT
                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│  API Gateway HTTP API (JWT Authorizer)                                │
│    └── VPC Link                                                       │
└──────────────────┬───────────────────────────────────────────────────┘
                   │ Private network
                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│  VPC (Private Isolated Subnets — NO NAT Gateway)                      │
│                                                                        │
│  ┌─────────────────────────────────────────────────────────┐          │
│  │  Internal ALB                                            │          │
│  │    /v1/search*        → Search Service (ECS Fargate)     │          │
│  │    /v1/reservations*  → Reservation Service (ECS Fargate)│          │
│  └─────────────────────────────────────────────────────────┘          │
│                         │                                              │
│                         ▼                                              │
│            ┌─────────────────────┐                                    │
│            │  RDS MySQL (Single-AZ)                                    │
│            │  Secrets Manager                                          │
│            └─────────────────────┘                                    │
│                         │                                              │
│                         ▼ (via VPC Endpoint)                           │
│            ┌─────────────────────┐                                    │
│            │  EventBridge                                              │
│            └────────┬────────────┘                                    │
│                     │ Fan-out                                          │
│          ┌──────────┼──────────┐                                      │
│          ▼                     ▼                                       │
│  ┌───────────────┐   ┌───────────────┐                                │
│  │ SQS Notif Q   │   │ SQS Analytics │                                │
│  └───────┬───────┘   └───────┬───────┘                                │
│          ▼                    ▼                                        │
│  ┌───────────────┐   ┌───────────────┐                                │
│  │ Lambda → SES  │   │ Lambda → S3   │                                │
│  └───────────────┘   └───────────────┘                                │
└──────────────────────────────────────────────────────────────────────┘
                                         │
                                         ▼
                              ┌─────────────────────┐
                              │  S3 Analytics Bucket │
                              │  → Athena Queries    │
                              └─────────────────────┘
```

### What's NOT in This Iteration

- ❌ OpenSearch (search uses MySQL directly)
- ❌ DMS (no CDC sync needed without OpenSearch)
- ❌ ElastiCache / Redis
- ❌ Multi-AZ RDS (single-AZ for cost savings during testing)

---

## Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| No NAT Gateway | VPC Endpoints for all AWS service access — saves ~$32/month |
| Private Isolated subnets only | Maximum security — no public subnets at all |
| API Gateway + VPC Link | ALB has no public IP, traffic stays on AWS backbone |
| ECS Fargate | No EC2 instances to manage, pay only when tasks run |
| EventBridge + SQS | Replaces Kafka — fully serverless, no brokers to manage |
| Lambda for notifications/analytics | Event-driven, scales to zero, no idle cost |
| Secrets Manager for DB credentials | No hardcoded passwords, auto-rotation ready |
| CloudFront + OAC | S3 buckets stay private, CDN for performance |
| WAFv2 on CloudFront | Rate limiting, SQL injection, XSS protection |

---

## CDK Stacks

| Stack | Resources | Estimated Cost (testing) |
|-------|-----------|--------------------------|
| `RoomHop-Network` | VPC, 2 private subnets, 7 VPC Endpoints, 6 SGs | $0.07/hr |
| `RoomHop-Database` | RDS MySQL Single-AZ (t3.medium), Secrets Manager | $0.07/hr |
| `RoomHop-Compute` | ECS Cluster, 2 Fargate tasks, internal ALB, 2 ECR repos | $0.10/hr |
| `RoomHop-Auth` | Cognito User Pool + Client | Free tier |
| `RoomHop-Api` | HTTP API, VPC Link, JWT Authorizer | Pay per request |
| `RoomHop-Frontend` | S3 buckets (website + images), CloudFront, WAFv2 | ~$0.01/hr |
| `RoomHop-Events` | EventBridge bus, 2 SQS queues + DLQs, 2 Lambda functions | Free tier |
| `RoomHop-Analytics` | Glue DB/Table, Athena workgroup, S3 results bucket | Pay per query |

**Total estimated cost: ~$0.75–$1.00 for a 2.5-hour test session.**

---

## Prerequisites

- **Node.js 18+**
- **AWS CLI v2** configured with credentials (`aws configure`)
- **AWS CDK CLI**: `npm install -g aws-cdk`
- **Docker** (to build ECS service images)
- An AWS account with sufficient permissions

---

## Deployment Steps

### 1. Bootstrap CDK (first time only)

```bash
cd infra
npm install
npx cdk bootstrap aws://YOUR_ACCOUNT_ID/us-east-1
```

### 2. Build and push Docker images

```bash
# Authenticate Docker with ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# Build search service
cd services/search-service
docker build -t roomhop/search-service:latest .
docker tag roomhop/search-service:latest YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/roomhop/search-service:latest
docker push YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/roomhop/search-service:latest

# Build reservation service
cd ../reservation-service
docker build -t roomhop/reservation-service:latest .
docker tag roomhop/reservation-service:latest YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/roomhop/reservation-service:latest
docker push YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/roomhop/reservation-service:latest
```

### 3. Deploy all stacks

```bash
cd infra
npx cdk deploy --all --require-approval never
```

Deployment takes ~15-20 minutes (RDS creation is the slowest).

### 4. Deploy the React frontend

```bash
# Build the React app
cd hotel-ui
npm run build

# Upload to S3 (get bucket name from CDK outputs)
aws s3 sync dist/ s3://roomhop-website-YOUR_ACCOUNT_ID/ --delete

# Invalidate CloudFront cache
aws cloudfront create-invalidation --distribution-id DIST_ID --paths "/*"
```

### 5. Upload hotel images

```bash
aws s3 sync local-images/ s3://roomhop-hotel-images-YOUR_ACCOUNT_ID/
```

### 6. Run database migrations

Connect to RDS via a bastion or Lambda function and run `database/migration_v2.sql` and `database/seed_v2.sql`.

### 7. Verify SES email identity

```bash
aws ses verify-email-identity --email-address your-test-email@example.com --region us-east-1
```

Check your inbox and click the verification link. In SES sandbox, you can only send to verified addresses.

---

## Post-Deployment Verification

1. **Frontend**: Open the CloudFront URL from CDK outputs
2. **Auth**: Sign up via Cognito → verify email → sign in
3. **Search**: Use the search form → API Gateway → ALB → Search Service → RDS
4. **Book**: Reserve a room → Reservation Service → RDS + EventBridge
5. **Notification**: Check your email (SES) for booking confirmation
6. **Analytics**: Check S3 analytics bucket for JSON records
7. **Athena**: Run a query in the Athena console using the `roomhop_analytics` database

---

## Destroying Everything

**IMPORTANT: Run this after testing to avoid ongoing charges.**

```bash
cd infra
npx cdk destroy --all
```

If RDS has deletion protection (enabled by default), first disable it in the console or change `deletionProtection: false` in `database-stack.ts` and redeploy before destroying.

---

## Project Structure

```
Hotel_Management_system/
├── hotel-api/                 # Local development (Docker Compose)
├── hotel-ui/                  # React SPA (shared between local + AWS)
├── notification-service/      # Local Kafka consumer
├── analytics-service/         # Local Kafka → Parquet
│
├── services/                  # ⭐ AWS-adapted application code
│   ├── search-service/        #   ECS Fargate (Express + Secrets Manager)
│   │   ├── Dockerfile
│   │   └── src/
│   ├── reservation-service/   #   ECS Fargate (Express + EventBridge)
│   │   ├── Dockerfile
│   │   └── src/
│   └── lambda/
│       ├── notification-handler/  # SQS → SES
│       └── analytics-handler/     # SQS → S3
│
└── infra/                     # ⭐ AWS CDK TypeScript
    ├── bin/app.ts             #   CDK app entry point
    └── lib/
        ├── config.ts          #   Shared configuration
        ├── network-stack.ts   #   VPC, subnets, endpoints, SGs
        ├── database-stack.ts  #   RDS MySQL, Secrets Manager
        ├── compute-stack.ts   #   ECS Fargate, ALB, ECR
        ├── auth-stack.ts      #   Cognito
        ├── api-stack.ts       #   API Gateway, VPC Link
        ├── frontend-stack.ts  #   S3, CloudFront, WAF
        ├── events-stack.ts    #   EventBridge, SQS, Lambda
        └── analytics-stack.ts #   Glue, Athena
```

---

## Security Model

| Layer | Protection |
|-------|-----------|
| Edge | WAFv2 (rate limiting, SQLi, XSS, common exploits) |
| CDN | CloudFront with OAC (S3 never public) |
| Auth | Cognito JWT verified at API Gateway |
| Network | Private subnets only, no public IPs, VPC Link |
| ALB | Security group: only accepts traffic from VPC CIDR |
| ECS | Security group: only accepts from ALB on port 3000 |
| RDS | Security group: only accepts from ECS on port 3306 |
| Secrets | Secrets Manager with IAM-scoped access |
| Lambda | VPC-attached, least-privilege IAM roles |

---

## Next Iterations (Roadmap)

- [ ] Add OpenSearch + DMS (CDC from RDS → OpenSearch for full-text search)
- [ ] Add ElastiCache Redis (caching for search queries)
- [ ] Enable Multi-AZ RDS for production HA
- [ ] Add CI/CD pipeline (CodePipeline or GitHub Actions)
- [ ] Add custom domain + ACM certificate
- [ ] SES production access (exit sandbox)
- [ ] Add Cognito hosted UI + social logins
- [ ] Auto-scaling policies for ECS services

---

## Environment Variables Reference

### Search Service (ECS)

| Variable | Value |
|----------|-------|
| `DB_SECRET_ARN` | From CDK output `DbSecretArn` |
| `DB_NAME` | `hotel_db` |
| `CDN_BASE_URL` | From CDK output `CloudFrontUrl` |
| `AWS_REGION` | `us-east-1` |
| `NODE_ENV` | `production` |
| `SERVICE_NAME` | `search-service` |

### Reservation Service (ECS)

| Variable | Value |
|----------|-------|
| `DB_SECRET_ARN` | From CDK output `DbSecretArn` |
| `DB_NAME` | `hotel_db` |
| `EVENT_BUS_NAME` | `roomhop-events` |
| `AWS_REGION` | `us-east-1` |
| `NODE_ENV` | `production` |
| `SERVICE_NAME` | `reservation-service` |

### Notification Lambda

| Variable | Value |
|----------|-------|
| `SENDER_EMAIL` | `noreply@roomhop.com` (must be SES-verified) |

### Analytics Lambda

| Variable | Value |
|----------|-------|
| `ANALYTICS_BUCKET` | From CDK output `AnalyticsBucketName` |
