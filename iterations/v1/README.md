# RoomHop — Iteration 1 (No OpenSearch)

Search queries MySQL directly. Fully self-contained deployment.

## Deploy

```bash
cd iterations/v1/infra
npm install
npx cdk deploy --all --require-approval never
```

Then build Docker images from `iterations/v1/services/` and deploy frontend from `hotel-ui/`.

See `infra/README.md` for the full step-by-step guide.

## Stack Names

All stacks are prefixed `RoomHop-V1-*` to avoid conflicts with other iterations.

## Destroy

```bash
cd iterations/v1/infra
npx cdk destroy --all --force
```
