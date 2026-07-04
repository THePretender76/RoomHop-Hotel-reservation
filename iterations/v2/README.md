# RoomHop — Iteration 2 (OpenSearch + DMS + Metabase)

## What's New vs Iteration 1

| Feature | v1 | v2 |
|---------|----|----|
| Search | MySQL direct | OpenSearch (fuzzy full-text) |
| DB sync | None | DMS CDC (RDS → OpenSearch, real-time) |
| BI Tool | None | Metabase (Athena + MySQL) |
| Stacks | 8 | 11 |

---

## Architecture Overview

```
Users → CloudFront (WAF) → S3 + API Gateway → ALB → ECS (Search/Reservation)
                                                        ↓
                                                   RDS MySQL ──(DMS CDC)──→ OpenSearch
                                                        ↓
                                                   EventBridge → SQS → Lambda → S3

Metabase → Separate CloudFront (WAF) → ALB → ECS (Metabase)
                                               ├── RDS MySQL (metabase_db)
                                               └── Athena (reservation analytics)
```

---

## CDK Stacks

| # | Stack | Key Resources |
|---|-------|--------------|
| 1 | `RoomHop-V2-Network` | VPC, subnets, VPC endpoints, security groups |
| 2 | `RoomHop-V2-Database` | RDS MySQL, Secrets Manager, migration Lambda |
| 3 | `RoomHop-V2-OpenSearch` | OpenSearch 2.11 domain (single node, VPC) |
| 4 | `RoomHop-V2-DMS` | DMS instance + full-load-and-cdc task |
| 5 | `RoomHop-V2-Compute` | ECS cluster, search + reservation services, ALB |
| 6 | `RoomHop-V2-Auth` | Cognito User Pool |
| 7 | `RoomHop-V2-Api` | API Gateway HTTP API + JWT Authorizer |
| 8 | `RoomHop-V2-Frontend` | S3, CloudFront, WAFv2 (main app) |
| 9 | `RoomHop-V2-Events` | EventBridge, SQS, notification + analytics Lambdas |
| 10 | `RoomHop-V2-Analytics` | Glue DB/Table, Athena workgroup, S3 results |
| 11 | `RoomHop-V2-Metabase` | Metabase ECS (2vCPU/4GB), dedicated CloudFront, DB init Lambda |

---

## Full Deployment Guide

### Prerequisites

- Node.js 18+, AWS CLI v2, CDK CLI, Docker Desktop
- AWS account bootstrapped: `npx cdk bootstrap aws://ACCOUNT_ID/us-east-1`

### Step 1 — Deploy infrastructure stacks (except Compute + Metabase)

```bash
cd iterations/v2/infra
npm install
npx cdk deploy RoomHop-V2-Network RoomHop-V2-Database RoomHop-V2-OpenSearch \
  RoomHop-V2-Auth RoomHop-V2-Events RoomHop-V2-Analytics RoomHop-V2-Frontend \
  --require-approval never
```

> RDS takes ~10 min, OpenSearch takes ~15 min. The DB migration Lambda runs automatically.

### Step 2 — Build and push application Docker images

```powershell
$ACCOUNT = aws sts get-caller-identity --query Account --output text
$REGION  = "us-east-1"

aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"

# Search service
cd iterations/v2/services/search-service
npm install
docker build -t roomhop-v2/search-service:latest .
docker tag roomhop-v2/search-service:latest "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/roomhop-v2/search-service:latest"
docker push "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/roomhop-v2/search-service:latest"

# Reservation service
cd ../reservation-service
docker build -t roomhop-v2/reservation-service:latest .
docker tag roomhop-v2/reservation-service:latest "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/roomhop-v2/reservation-service:latest"
docker push "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/roomhop-v2/reservation-service:latest"
```

### Step 3 — Mirror Metabase image to ECR

The Metabase container is pulled from Docker Hub and mirrored to ECR (no internet access from ECS).

```powershell
cd iterations/v2
.\scripts\mirror-metabase-to-ecr.ps1
```

### Step 4 — Deploy Compute and Metabase stacks

```bash
cd iterations/v2/infra
npx cdk deploy RoomHop-V2-Compute RoomHop-V2-Api RoomHop-V2-DMS RoomHop-V2-Metabase \
  --require-approval never
```

> Metabase starts slowly (~3-5 min) on first launch while it runs its internal DB migrations.

### Step 5 — Build and upload the React frontend

```powershell
# Get CDK outputs
$API_URL  = aws cloudformation describe-stacks --stack-name RoomHop-V2-Api --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" --output text
$CF_URL   = aws cloudformation describe-stacks --stack-name RoomHop-V2-Frontend --query "Stacks[0].Outputs[?OutputKey=='CloudFrontUrl'].OutputValue" --output text
$POOL_ID  = aws cloudformation describe-stacks --stack-name RoomHop-V2-Auth --query "Stacks[0].Outputs[?OutputKey=='UserPoolId'].OutputValue" --output text
$CLIENT   = aws cloudformation describe-stacks --stack-name RoomHop-V2-Auth --query "Stacks[0].Outputs[?OutputKey=='UserPoolClientId'].OutputValue" --output text
$BUCKET   = aws cloudformation describe-stacks --stack-name RoomHop-V2-Frontend --query "Stacks[0].Outputs[?OutputKey=='WebsiteBucketName'].OutputValue" --output text
$DIST_ID  = aws cloudformation describe-stacks --stack-name RoomHop-V2-Frontend --query "Stacks[0].Outputs[?OutputKey=='DistributionId'].OutputValue" --output text

cd hotel-ui
$env:VITE_API_URL = $API_URL
$env:VITE_IMAGES_URL = "$CF_URL/images"
$env:VITE_COGNITO_USER_POOL_ID = $POOL_ID
$env:VITE_COGNITO_CLIENT_ID = $CLIENT
$env:VITE_AWS_REGION = "us-east-1"
npm run build

aws s3 sync dist/ "s3://$BUCKET/" --exclude "images/*" --delete --region us-east-1
aws s3 sync C:\temp\s3-proper "s3://$BUCKET/images/" --region us-east-1
aws cloudfront create-invalidation --distribution-id $DIST_ID --paths "/*" --region us-east-1
```

### Step 6 — Configure Metabase

1. Open the Metabase CloudFront URL (from `RoomHop-V2-Metabase` outputs: `MetabaseUrl`)
2. Complete the initial setup wizard
3. Add Athena as a data source:
   - **Engine**: Amazon Athena
   - **Region**: us-east-1
   - **S3 staging directory**: from `MetabaseAthenaStagingDir` output
   - **Workgroup**: `roomhop-v2-analytics`
   - **Catalog**: AwsDataCatalog
   - **Database**: `roomhop-v2_analytics`
   - **Authentication**: Use IAM role (no access keys — Metabase uses the ECS task role)

4. Add MySQL as a data source (for live reservation data):
   - **Engine**: MySQL
   - **Host**: from `RoomHop-V2-Database` → `DbEndpoint` output
   - **Port**: 3306
   - **Database**: `hotel_db`
   - **Username/Password**: from Secrets Manager `/metabase/db-credentials`

---

## Key Design Decisions

### Why a separate CloudFront distribution for Metabase?

Metabase requires:
- All cookies forwarded (session management)
- All headers forwarded (CSRF protection)
- No caching whatsoever

Adding these as a behavior on the main distribution would have leaked session cookies to the main WAF rules, caused CSRF failures, and broken Metabase's SPA routing. A dedicated distribution gives clean isolation.

### Why host-header routing on the ALB?

The ALB serves both the application (search/reservation) and Metabase. Using host-header conditions (priority 30) instead of path conditions avoids URL prefix conflicts and keeps the services logically separated without needing a second ALB.

### Why a DB init Lambda?

Metabase needs its own MySQL database (`metabase_db`) and a dedicated user with limited privileges. Rather than doing this manually or embedding it in the migration Lambda, a dedicated Custom Resource Lambda runs at deploy time and is idempotent — safe to run on every UPDATE.

---

## Estimated Cost (per hour)

| Resource | v1 cost/hr | v2 addition |
|----------|-----------|-------------|
| OpenSearch t3.small | — | +$0.036 |
| DMS t3.micro | — | +$0.018 |
| Metabase ECS (2vCPU/4GB) | — | +$0.09 |
| Metabase CloudFront | — | ~$0.005 |
| **Total v2** | ~$0.25/hr | ~$0.40/hr |

---

## Destroy

```bash
cd iterations/v2/infra
npx cdk destroy --all --force
```

**Note**: If Lambda VPC ENIs stall the destroy (known AWS behavior), manually delete them:
```bash
aws ec2 describe-network-interfaces \
  --filters "Name=vpc-id,Values=<VPC_ID>" \
  --query "NetworkInterfaces[?Status=='available'].[NetworkInterfaceId]" \
  --output text | ForEach-Object { aws ec2 delete-network-interface --network-interface-id $_ }
```
