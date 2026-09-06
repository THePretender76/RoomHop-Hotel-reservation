# Mirrors the pinned ADOT Collector image to the private RoomHop ECR repository.
# This is optional because CDK assets bootstrap the first deployment and the
# pipeline subsequently builds the same Dockerfile.

param(
    [string]$Version = "v0.49.0"
)

$ErrorActionPreference = "Stop"

$AccountId = aws sts get-caller-identity --query Account --output text
$Region = "us-east-1"
$SourceImage = "public.ecr.aws/aws-observability/aws-otel-collector:$Version"
$EcrRepository = "$AccountId.dkr.ecr.$Region.amazonaws.com/roomhop/adot-collector"

aws ecr-public get-login-password --region us-east-1 |
    docker login --username AWS --password-stdin public.ecr.aws
aws ecr get-login-password --region $Region |
    docker login --username AWS --password-stdin "$AccountId.dkr.ecr.$Region.amazonaws.com"

docker pull $SourceImage
docker tag $SourceImage "${EcrRepository}:$Version"
docker push "${EcrRepository}:$Version"

Write-Host "ADOT Collector mirrored to ${EcrRepository}:$Version" -ForegroundColor Green
