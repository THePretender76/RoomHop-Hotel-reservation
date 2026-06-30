# RoomHop — AWS Cloud Deployment (Iteration 1)

## Overview

This is the AWS production deployment of the RoomHop Hotel Booking Platform using AWS CDK v2 (TypeScript). This first iteration deploys the core booking system **without** OpenSearch and DMS — the search service queries MySQL directly.

### What's Deployed

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser                                                              │
│    ├── Cognito (JWT Authentication)                                   │
│    └── CloudFront (WAF) → S3 Website + Hotel Images (/images/)        │
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

## Full Deployment Guide (Step-by-Step)

### Prerequisites

- **Node.js 18+**
- **AWS CLI v2** configured with credentials (`aws configure`)
- **AWS CDK CLI**: `npm install -g aws-cdk`
- **Docker Desktop** (must be running)
- An AWS account with sufficient permissions
- Hotel images available locally at `C:\temp\s3-proper\` (or wherever you stored them)

### Step 1: Bootstrap CDK (first time only)

```bash
cd infra
npm install
npx cdk bootstrap aws://YOUR_ACCOUNT_ID/us-east-1
```

### Step 2: Clean up leftover resources from previous deployments

If you previously deployed and destroyed, remnant resources may conflict with CDK:

```bash
# Delete orphaned ECR repos (if they exist)
aws ecr delete-repository --repository-name roomhop/search-service --region us-east-1 --force 2>nul
aws ecr delete-repository --repository-name roomhop/reservation-service --region us-east-1 --force 2>nul

# Delete orphaned S3 buckets (if they exist)
aws s3 rb s3://roomhop-website-YOUR_ACCOUNT_ID --force 2>nul
aws s3 rb s3://roomhop-hotel-images-YOUR_ACCOUNT_ID --force 2>nul
aws s3 rb s3://roomhop-analytics-data-YOUR_ACCOUNT_ID --force 2>nul
aws s3 rb s3://roomhop-athena-results-YOUR_ACCOUNT_ID --force 2>nul
```

> **Note**: For versioned buckets (website bucket), you may need to delete all object versions first:
> ```powershell
> $versions = aws s3api list-object-versions --bucket roomhop-website-YOUR_ACCOUNT_ID --region us-east-1 --output json | ConvertFrom-Json
> $objects = @()
> if ($versions.Versions) { foreach ($v in $versions.Versions) { $objects += @{Key=$v.Key; VersionId=$v.VersionId} } }
> if ($versions.DeleteMarkers) { foreach ($d in $versions.DeleteMarkers) { $objects += @{Key=$d.Key; VersionId=$d.VersionId} } }
> $delete = @{Objects=$objects; Quiet=$true}
> $json = $delete | ConvertTo-Json -Depth 3 -Compress
> $json | Out-File C:\temp\delete.json -Encoding ASCII
> aws s3api delete-objects --bucket roomhop-website-YOUR_ACCOUNT_ID --region us-east-1 --delete "file://C:/temp/delete.json"
> aws s3 rb s3://roomhop-website-YOUR_ACCOUNT_ID --region us-east-1
> ```

### Step 3: Deploy all CDK stacks (except Compute)

Deploy everything except the Compute stack first (to avoid image pull failures):

```bash
cd infra
npx cdk deploy RoomHop-Network RoomHop-Database RoomHop-Auth RoomHop-Events RoomHop-Analytics RoomHop-Frontend --require-approval never
```

This takes ~10-15 minutes (RDS creation is the slowest). The DB migration Lambda runs automatically and seeds the database.

### Step 4: Deploy the Compute stack

Now deploy Compute — CDK will create ECR repos:

```bash
npx cdk deploy RoomHop-Compute --require-approval never
```

> **Important**: This will create the ECR repos but ECS tasks will fail to start because no images exist yet. That's expected — we'll push images next.

### Step 5: Build and push Docker images

```bash
# Authenticate Docker with ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com

# Build and push search service
cd services/search-service
docker build -t roomhop/search-service:latest .
docker tag roomhop/search-service:latest YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/roomhop/search-service:latest
docker push YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/roomhop/search-service:latest

# Build and push reservation service
cd ../reservation-service
docker build -t roomhop/reservation-service:latest .
docker tag roomhop/reservation-service:latest YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/roomhop/reservation-service:latest
docker push YOUR_ACCOUNT_ID.dkr.ecr.us-east-1.amazonaws.com/roomhop/reservation-service:latest
```

### Step 6: Force ECS to pull new images

```bash
aws ecs update-service --cluster roomhop-cluster --service roomhop-search --force-new-deployment --region us-east-1
aws ecs update-service --cluster roomhop-cluster --service roomhop-reservation --force-new-deployment --region us-east-1
```

Wait ~1-2 minutes for the tasks to become healthy.

### Step 7: Deploy the API stack

The API stack depends on Compute (needs the ALB listener ARN):

```bash
cd infra
npx cdk deploy RoomHop-Api --require-approval never
```

### Step 8: Note the CDK outputs

After deployment, note these values from the stack outputs:

```bash
# Get all important outputs
aws cloudformation describe-stacks --stack-name RoomHop-Frontend --region us-east-1 --query "Stacks[0].Outputs" --output table
aws cloudformation describe-stacks --stack-name RoomHop-Api --region us-east-1 --query "Stacks[0].Outputs" --output table
aws cloudformation describe-stacks --stack-name RoomHop-Auth --region us-east-1 --query "Stacks[0].Outputs" --output table
```

You'll need:
- `CloudFrontUrl` — e.g. `https://dxxxxxx.cloudfront.net`
- `WebsiteBucketName` — e.g. `roomhop-website-370314719865`
- `DistributionId` — e.g. `E1TD4GYJ6F7LZO`
- `ApiEndpoint` — e.g. `https://xxxxxxx.execute-api.us-east-1.amazonaws.com`
- `UserPoolId` — e.g. `us-east-1_xxxxxxx`
- `UserPoolClientId` — e.g. `xxxxxxxxxxxxxxxxx`

### Step 9: Build and deploy the React frontend

```powershell
cd hotel-ui

# Set environment variables (replace with YOUR actual CDK output values)
$env:VITE_API_URL="<ApiEndpoint>"
$env:VITE_IMAGES_URL="<CloudFrontUrl>/images"
$env:VITE_COGNITO_USER_POOL_ID="<UserPoolId>"
$env:VITE_COGNITO_CLIENT_ID="<UserPoolClientId>"
$env:VITE_AWS_REGION="us-east-1"

# Build
npm run build

# Upload to S3 (exclude images path to avoid deleting them later)
aws s3 sync dist/ s3://<WebsiteBucketName>/ --exclude "images/*" --delete --region us-east-1
```

### Step 10: Upload hotel images

Images are served from the **website bucket** under the `/images/` prefix (NOT from a separate images bucket):

```bash
aws s3 sync C:\temp\s3-proper s3://<WebsiteBucketName>/images/ --region us-east-1
```

> **Critical**: The database seeds reference specific filenames. Ensure these files exist:
> - `hotel_beaux_arts.png` (Hotel Beaux Arts primary image)
> - `hotel_grand_palais.png` (Hotel Grand Palais primary image — may need to copy from `grand_palais.png`)
> - `hotel_marina.png` (Hotel Marina Bay primary image — may need to copy from `marina_bay.png`)
>
> If your source files have different names, copy them:
> ```bash
> aws s3 cp s3://<WebsiteBucketName>/images/grand_palais.png s3://<WebsiteBucketName>/images/hotel_grand_palais.png --region us-east-1
> aws s3 cp s3://<WebsiteBucketName>/images/marina_bay.png s3://<WebsiteBucketName>/images/hotel_marina.png --region us-east-1
> ```

### Step 11: Invalidate CloudFront cache

```bash
aws cloudfront create-invalidation --distribution-id <DistributionId> --paths "/*" --region us-east-1
```

### Step 12: Verify SES email (for booking confirmations)

SES is in sandbox mode. You must verify both sender and recipient:

```bash
aws ses verify-email-identity --email-address YOUR_EMAIL@gmail.com --region us-east-1
```

Check your inbox (and spam) for the AWS verification link and click it.

### Step 13: Test the site

Open `<CloudFrontUrl>` in your browser:
1. **Search**: Search for hotels in "Paris" with valid dates
2. **Sign Up**: Create a Cognito account (check spam for verification code)
3. **Book**: Select a room, fill in details, confirm booking
4. **My Reservations**: Should auto-load your bookings (no guest ID needed)
5. **Email**: Check for booking confirmation email

---

## Destroying Everything

**IMPORTANT: Run this after testing to avoid ongoing charges.**

```bash
cd infra
npx cdk destroy --all --force
```

Since all resources use `removalPolicy: DESTROY` and `deletionProtection: false`, this will cleanly remove everything including:
- RDS instance (no deletion protection)
- S3 buckets (auto-delete objects enabled)
- ECR repos (auto-delete images)
- All other resources

---

## Troubleshooting

### ECS tasks fail to start
- Ensure Docker images are pushed to ECR before deploying Compute
- Check CloudWatch logs: `/ecs/roomhop/search` and `/ecs/roomhop/reservation`

### "Failed to fetch" on booking
- Check API Gateway CORS allows `Idempotency-Key` header (already configured)
- Verify the JWT token is valid (sign out and sign back in)

### Images not loading
- Ensure images are in `s3://<WebsiteBucketName>/images/` (NOT in the images bucket)
- Check the filenames match what's in the database seed (see Step 10)

### No booking confirmation email
- Verify your email in SES (Step 12)
- The sender email in `events-stack.ts` must be a verified SES address
- Check the notification Lambda logs: `/aws/lambda/roomhop-notification-handler`
- Check the notification DLQ for failed messages

### Migration fails with "Table already exists"
- The migration Lambda drops and recreates all tables on each run
- If it fails, bump `migrationVersion` in `database-stack.ts` and redeploy

### ECR repos already exist (CDK deploy fails)
- Delete them manually: `aws ecr delete-repository --repository-name roomhop/search-service --region us-east-1 --force`

### Search returns "Internal server error"
- Check search service logs: `/ecs/roomhop/search`
- Common cause: schema mismatch between the SQL query and actual table columns

---

## CDK Stacks

| Stack | Resources |
|-------|-----------|
| `RoomHop-Network` | VPC, 2 private subnets, 8 VPC Endpoints, 6 Security Groups |
| `RoomHop-Database` | RDS MySQL Single-AZ (t3.medium), Secrets Manager, Migration Lambda |
| `RoomHop-Compute` | ECS Cluster, 2 Fargate tasks, internal ALB, 2 ECR repos |
| `RoomHop-Auth` | Cognito User Pool + Client |
| `RoomHop-Api` | HTTP API, VPC Link, JWT Authorizer, CORS (incl. Idempotency-Key) |
| `RoomHop-Frontend` | S3 buckets (website + images), CloudFront, WAFv2 |
| `RoomHop-Events` | EventBridge bus, 2 SQS queues + DLQs, 2 Lambda functions |
| `RoomHop-Analytics` | Glue DB/Table, Athena workgroup, S3 results bucket |

---

## Key Architecture Decisions

| Decision | Rationale |
|----------|-----------|
| No NAT Gateway | VPC Endpoints for all AWS service access — saves ~$32/month |
| Private Isolated subnets only | Maximum security — no public subnets |
| API Gateway + VPC Link | ALB has no public IP, traffic stays on AWS backbone |
| ECS Fargate | No EC2 instances to manage, pay only when tasks run |
| EventBridge + SQS | Replaces Kafka — fully serverless, no brokers |
| Lambda for notifications/analytics | Event-driven, scales to zero |
| Images in website bucket `/images/` | Single CloudFront origin, no separate images behavior needed |
| `deletionProtection: false` | Easy teardown after testing |
| `removalPolicy: DESTROY` on all resources | Clean destroy without orphaned resources |
| Cognito auth opt-in via env vars | Local dev works without any AWS dependencies |

---

## Environment Variables Reference

### Frontend Build (Vite)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | API Gateway endpoint URL |
| `VITE_IMAGES_URL` | `<CloudFrontUrl>/images` |
| `VITE_COGNITO_USER_POOL_ID` | Cognito User Pool ID |
| `VITE_COGNITO_CLIENT_ID` | Cognito App Client ID |
| `VITE_AWS_REGION` | `us-east-1` |

### ECS Services (auto-configured by CDK)

| Variable | Value |
|----------|-------|
| `DB_SECRET_ARN` | Secrets Manager ARN for DB credentials |
| `DB_NAME` | `hotel_db` |
| `AWS_REGION` | `us-east-1` |
| `NODE_ENV` | `production` |

---

## Next Iterations (Roadmap)

- [ ] Add OpenSearch + DMS (CDC from RDS → OpenSearch for full-text search)
- [ ] Add ElastiCache Redis (caching for search queries)
- [ ] Enable Multi-AZ RDS for production HA
- [ ] Add CI/CD pipeline (CodePipeline or GitHub Actions)
- [ ] Add custom domain + ACM certificate
- [ ] SES production access (exit sandbox)
- [ ] Configure Cognito to use SES with custom domain (avoid spam)
- [ ] Auto-scaling policies for ECS services
