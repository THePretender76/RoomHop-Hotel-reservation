# =============================================================================
# mirror-metabase-to-ecr.ps1
# Pulls metabase/metabase:latest from Docker Hub and pushes it to ECR.
# Run this BEFORE deploying the Metabase stack.
# Usage: .\mirror-metabase-to-ecr.ps1 [-Version v0.50.0]
# =============================================================================

param(
    [string]$Version = "latest"
)

$ErrorActionPreference = "Stop"

$AccountId = aws sts get-caller-identity --query Account --output text
$Region    = "us-east-1"
$Project   = "roomhop-v2"
$EcrRepo   = "$AccountId.dkr.ecr.$Region.amazonaws.com/$Project/metabase"

Write-Host "==> Authenticating with ECR..." -ForegroundColor Cyan
aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin "$AccountId.dkr.ecr.$Region.amazonaws.com"

Write-Host "==> Pulling metabase/metabase:$Version from Docker Hub..." -ForegroundColor Cyan
docker pull "metabase/metabase:$Version"

Write-Host "==> Tagging for ECR..." -ForegroundColor Cyan
docker tag "metabase/metabase:$Version" "${EcrRepo}:$Version"
docker tag "metabase/metabase:$Version" "${EcrRepo}:latest"

Write-Host "==> Pushing to ECR..." -ForegroundColor Cyan
docker push "${EcrRepo}:$Version"
docker push "${EcrRepo}:latest"

Write-Host ""
Write-Host "✅  Metabase image mirrored successfully!" -ForegroundColor Green
Write-Host "    ECR URI: ${EcrRepo}:latest" -ForegroundColor Green
Write-Host ""
Write-Host "Next step: deploy the Metabase CDK stack:" -ForegroundColor Yellow
Write-Host "    npx cdk deploy RoomHop-V2-Metabase --require-approval never" -ForegroundColor Yellow
