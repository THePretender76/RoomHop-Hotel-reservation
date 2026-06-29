# RoomHop Hotel Management System — Infrastructure

AWS CDK v2 TypeScript infrastructure for the RoomHop Hotel Management System.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│  CloudFront (WAF) → S3 Static Website + Hotel Images                    │
│                   → API Gateway (HTTP API)                              │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │ JWT Authorizer (Cognito)
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  API Gateway HTTP API → VPC Link → Internal ALB                         │
└─────────────────────┬───────────────────────────────────────────────────┘
                      │ Path-based routing
                      ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  ECS Fargate (Private Isolated Subnets)                                 │
│  ┌──────────────┐  ┌────────────────────┐  ┌───────────────┐           │
│  │ Search Svc   │  │ Reservation Svc    │  │ Admin Svc     │           │
│  └──────┬───────┘  └────────┬───────────┘  └───────┬───────┘           │
│         │                    │                       │                   │
│         ▼                    ▼                       ▼                   │
│  ┌──────────────┐  ┌────────────────────┐  ┌───────────────┐           │
│  │ OpenSearch   │  │ RDS MySQL (Multi-AZ)│  │ Secrets Mgr   │           │
│  └──────────────┘  └────────────────────┘  └───────────────┘           │
└─────────────────────────────────────────────────────────────────────────┘
                      │
                      ▼ EventBridge
┌─────────────────────────────────────────────────────────────────────────┐
│  EventBridge → SQS → Lambda (Notifications via SES)                     │
│             → SQS → Lambda (Analytics → S3 Data Lake → Athena)          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

- **No NAT Gateway**: All services run in PRIVATE_ISOLATED subnets. AWS service access is provided exclusively through VPC Endpoints (Gateway for S3, Interface for all others).
- **Least-privilege security groups**: Each layer only accepts traffic from the layer directly above it.
- **Multi-AZ**: VPC spans 2 AZs. RDS and OpenSearch are both Multi-AZ for high availability.
- **Event-driven architecture**: Booking events flow through EventBridge to SQS queues, then to Lambda handlers for notifications and analytics.
- **OAC (Origin Access Control)**: CloudFront uses the modern OAC approach for S3 bucket access.

## Stacks

| Stack | Resources |
|-------|-----------|
| `RoomHop-Network` | VPC, private subnets, VPC endpoints, security groups |
| `RoomHop-Database` | RDS MySQL Multi-AZ, Secrets Manager |
| `RoomHop-Search` | OpenSearch Service (VPC) |
| `RoomHop-Compute` | ECS Fargate cluster, 3 services, internal ALB, ECR repos |
| `RoomHop-Auth` | Cognito User Pool + Client |
| `RoomHop-Api` | API Gateway HTTP API, VPC Link, JWT authorizer |
| `RoomHop-Frontend` | S3 buckets, CloudFront distribution, WAFv2 |
| `RoomHop-Events` | EventBridge, SQS queues, Lambda functions |
| `RoomHop-Analytics` | Glue database/table, Athena workgroup |

## Prerequisites

- Node.js 18+
- AWS CDK CLI v2 (`npm install -g aws-cdk`)
- AWS credentials configured
- Docker images pushed to ECR repositories before first deploy

## Getting Started

```bash
# Install dependencies
npm install

# Compile TypeScript (type-check)
npx tsc --noEmit

# Synthesize CloudFormation templates
npx cdk synth

# Deploy all stacks
npx cdk deploy --all

# Destroy all stacks (careful!)
npx cdk destroy --all
```

## Configuration

Edit `lib/config.ts` to modify:
- VPC CIDR and AZ count
- RDS instance type and database name
- ECS service sizing (CPU/memory/desired count)
- OpenSearch instance type and count
- S3 bucket name prefixes

## Post-Deployment Steps

1. **Push Docker images** to the 3 ECR repositories created by the Compute stack
2. **Verify SES** email identity for the notification sender address
3. **Update Cognito callback URLs** with the actual CloudFront domain
4. **Deploy React build** to the website S3 bucket
5. **Upload hotel images** to the images S3 bucket
