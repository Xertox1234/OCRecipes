---
title: "Add GIN indexes and parallelize independent DB calls"
status: done
priority: medium
created: 2026-03-27
updated: 2026-03-29
assignee:
labels: [performance, database, server]
---

# Add GIN indexes and parallelize independent DB calls

## Summary

Add PostgreSQL GIN indexes for ILIKE text searches and JSONB containment queries, then parallelize independent sequential DB calls in 4-5 route handlers.

## Background

The launch audit identified these as medium-impact performance items. They won't cause issues at launch volume but will degrade as the user base grows:

- `getCommunityRecipes` uses `ILIKE '%pattern%'` — always sequential scans without trigram index
- `getUnifiedRecipes` uses `@>` JSONB containment on `dietTags`/`mealTypes` — sequential scans without GIN
- Several route handlers make 2-3 independent DB calls sequentially that could use `Promise.all`

## Acceptance Criteria

- [ ] `pg_trgm` extension enabled, GIN trigram index on `community_recipes.normalized_product_name`
- [ ] GIN index on `community_recipes.diet_tags` (JSONB)
- [ ] GIN index on `meal_plan_recipes.diet_tags` and `meal_plan_recipes.meal_types` (JSONB)
- [ ] `Promise.all` for independent calls in: `/api/daily-budget` (getUser + getDailySummary), `getUserVerificationStats` (dates queries), `createSavedItem` route (count + subscription — note: the storage function itself is now transactional, but the route may still have independent calls)
- [ ] Before/after query timing for ILIKE search at ~1000 community recipes

## Implementation Notes

- GIN trigram indexes require `CREATE EXTENSION IF NOT EXISTS pg_trgm` — add to a migration
- Drizzle schema: use `index().using("gin")` syntax
- For ILIKE with leading wildcard, the trigram GIN index is the only option — btree won't help
- The `Promise.all` changes are straightforward: identify independent calls, wrap in Promise.all, destructure results
- Don't parallelize calls that have data dependencies (e.g., `getPlannedNutritionSummary` depends on `confirmedIds`)

## Dependencies

- Database migration needed for indexes (run `db:push` or create explicit migration)

## Risks

- GIN indexes increase write overhead slightly (acceptable for read-heavy tables)
- `pg_trgm` extension may not be available on all PostgreSQL providers (verify with hosting)

## Updates

### 2026-03-27

- Identified during launch readiness audit (performance domain)
