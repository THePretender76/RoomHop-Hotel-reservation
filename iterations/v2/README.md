# RoomHop — Iteration 2 (With OpenSearch + DMS)

Search queries OpenSearch for full-text search. DMS syncs data from RDS via CDC.

## Status: IN PROGRESS

TODOs:
- [ ] Create `opensearch-stack.ts` (OpenSearch domain in private subnet)
- [ ] Create `dms-stack.ts` (DMS CDC replication from RDS → OpenSearch)
- [ ] Update Search Service to query OpenSearch instead of MySQL
- [ ] Add OpenSearch VPC endpoint to network-stack
- [ ] Update security groups (ECS → OpenSearch on port 443)
- [ ] Test full search flow with OpenSearch

## Deploy

```bash
cd iterations/v2/infra
npm install
npx cdk deploy --all --require-approval never
```

## Stack Names

All stacks are prefixed `RoomHop-V2-*` to avoid conflicts with iteration 1.

## Destroy

```bash
cd iterations/v2/infra
npx cdk destroy --all --force
```
