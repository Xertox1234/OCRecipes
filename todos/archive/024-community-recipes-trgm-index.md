---
title: "Add pg_trgm GIN index for community recipe ILIKE search"
status: done
priority: low
created: 2026-03-27
updated: 2026-03-27
assignee:
labels: [performance, database, audit-2026-03-27-full]
audit_id: L4
---

# Add pg_trgm GIN index for community recipe ILIKE search

## Summary

`server/storage/community.ts:59` uses `ILIKE '%...%'` on `normalizedProductName` which can't use the existing B-tree index. Needs a `pg_trgm` GIN index.

## Acceptance Criteria

- [x] `pg_trgm` extension enabled
- [x] GIN index on `normalized_product_name` with `gin_trgm_ops`
- [x] Same for `title` and `description` columns used by `getUnifiedRecipes`
- [x] Query performance improves at scale

## Implementation Notes

- `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
- `CREATE INDEX community_recipes_name_trgm_idx ON community_recipes USING gin (normalized_product_name gin_trgm_ops);`

## Dependencies

- PostgreSQL must have `pg_trgm` extension available

## Risks

- GIN indexes increase write latency and storage — acceptable trade-off for read performance

## Updates

### 2026-03-27

- Created from full audit finding L4

### 2026-03-28

- Implemented: migration script `migrations/0001_enable_pg_trgm.sql` for extension
- Replaced B-tree `normalizedNameIdx` with GIN `normalizedNameTrgmIdx` on `communityRecipes`
- Added GIN trgm indexes on `communityRecipes.title`, `communityRecipes.description`
- Added GIN trgm indexes on `mealPlanRecipes.title`, `mealPlanRecipes.description`
- All 3144 tests pass, TypeScript compiles cleanly
