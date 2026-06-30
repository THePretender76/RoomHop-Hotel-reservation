# RoomHop — Iteration 2 (OpenSearch + DMS CDC)

## What's New in V2

- **OpenSearch**: Full-text search with fuzzy matching, replaces direct MySQL queries
- **DMS CDC**: Change Data Capture from RDS MySQL → OpenSearch (real-time sync)
- **Search Service v2**: Queries OpenSearch for rich search, falls back to MySQL if OpenSearch is unavailable

## Architecture Addition

```
RDS MySQL ──(DMS CDC)──→ OpenSearch Domain
                              ↑
                    Search Service (ECS)
```

DMS performs:
1. **Full Load**: Initial copy of hotel, room_type, room_type_rate, room_type_inventory, hotel_images tables
2. **CDC (ongoing)**: Captures INSERT/UPDATE/DELETE changes and replicates to OpenSearch in near real-time

## New Stacks

| Stack | Resources |
|-------|-----------|
| `RoomHop-V2-OpenSearch` | OpenSearch domain (t3.small.search, single node, VPC) |
| `RoomHop-V2-DMS` | DMS replication instance, source/target endpoints, CDC task |

## Deploy

```bash
cd iterations/v2/infra
npm install
npx cdk deploy --all --require-approval never
```

Then build Docker images from `iterations/v2/services/` and deploy frontend from `hotel-ui/`.

## Important Notes

- OpenSearch takes ~15 minutes to create
- DMS replication instance takes ~5 minutes
- After deployment, the DMS task starts automatically (full-load + CDC)
- The Search Service detects OpenSearch via `OPENSEARCH_ENDPOINT` env var
- If OpenSearch is down, it falls back to MySQL (same as v1)

## Estimated Additional Cost

| Resource | Hourly |
|----------|--------|
| OpenSearch (t3.small.search) | $0.036 |
| DMS (dms.t3.micro) | $0.018 |
| **Total v2 addition** | **~$0.054/hr** |

## Destroy

```bash
cd iterations/v2/infra
npx cdk destroy --all --force
```
