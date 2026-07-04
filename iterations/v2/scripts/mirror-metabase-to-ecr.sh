#!/bin/bash
# =============================================================================
# mirror-metabase-to-ecr.sh
# Pulls metabase/metabase:latest from Docker Hub and pushes it to ECR.
# Run this BEFORE deploying the Metabase stack.
# =============================================================================

set -euo pipefail

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION="us-east-1"
PROJECT="roomhop-v2"
ECR_REPO="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${PROJECT}/metabase"
METABASE_VERSION="${1:-latest}"   # pass version as arg, e.g. v0.50.0

echo "==> Authenticating with ECR..."
aws ecr get-login-password --region "${REGION}" \
  | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

echo "==> Pulling metabase/metabase:${METABASE_VERSION} from Docker Hub..."
docker pull "metabase/metabase:${METABASE_VERSION}"

echo "==> Tagging for ECR..."
docker tag "metabase/metabase:${METABASE_VERSION}" "${ECR_REPO}:${METABASE_VERSION}"
docker tag "metabase/metabase:${METABASE_VERSION}" "${ECR_REPO}:latest"

echo "==> Pushing to ECR..."
docker push "${ECR_REPO}:${METABASE_VERSION}"
docker push "${ECR_REPO}:latest"

echo ""
echo "✅  Metabase image mirrored successfully!"
echo "    ECR URI: ${ECR_REPO}:latest"
echo ""
echo "Next step: deploy the Metabase CDK stack:"
echo "    npx cdk deploy RoomHop-V2-Metabase --require-approval never"
