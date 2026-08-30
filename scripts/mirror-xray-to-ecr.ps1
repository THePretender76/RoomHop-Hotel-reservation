# =============================================================================
# mirror-xray-to-ecr.ps1
# Pulls the X-Ray daemon from ECR Public and mirrors it to your private ECR.
# Run this BEFORE deploying the Compute stack.
#
# Usage: .\mirror-xray-to-ecr.ps1 [-Version latest]
# =============================================================================

param(
    [string]$Version = "latest"
)

$ErrorActionPreference = "Stop"

$AccountId = aws sts get-caller-identity --query Account --output text
$Region    = "us-east-1"
$Project   = aws cloudformation describe-stacks --stack-name RoomHop-Network --region $Region --query "Stacks[0].Tags[?Key=='project'].Value" --output text 2>$null
if (-not $Project) { $Project = "roomhop" }   # fallback to default

$SourceImage = "public.ecr.aws/xray/aws-xray-daemon:$Version"
$EcrRepo     = "$AccountId.dkr.ecr.$Region.amazonaws.com/$Project/xray-daemon"

Write-Host ""
Write-Host "==> Step 1: Authenticate with ECR Public (us-east-1 required)..." -ForegroundColor Cyan
# ECR Public authentication MUST use us-east-1 regardless of your region
aws ecr-public get-login-password --region us-east-1 | docker login --username AWS --password-stdin public.ecr.aws

Write-Host "==> Step 2: Authenticate with your private ECR..." -ForegroundColor Cyan
aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin "$AccountId.dkr.ecr.$Region.amazonaws.com"

Write-Host "==> Step 3: Pull X-Ray daemon from ECR Public..." -ForegroundColor Cyan
docker pull $SourceImage

Write-Host "==> Step 4: Tag for private ECR..." -ForegroundColor Cyan
docker tag $SourceImage "${EcrRepo}:$Version"
if ($Version -ne "latest") {
    docker tag $SourceImage "${EcrRepo}:latest"
}

Write-Host "==> Step 5: Push to private ECR..." -ForegroundColor Cyan
docker push "${EcrRepo}:$Version"
if ($Version -ne "latest") {
    docker push "${EcrRepo}:latest"
}

Write-Host ""
Write-Host "✅  X-Ray daemon mirrored successfully!" -ForegroundColor Green
Write-Host "    ECR URI: ${EcrRepo}:latest" -ForegroundColor Green
Write-Host ""
Write-Host "Next step: deploy the Compute stack:" -ForegroundColor Yellow
Write-Host "    cd infra && npx cdk deploy RoomHop-Compute --require-approval never" -ForegroundColor Yellow
