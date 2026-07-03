---
title: 'Parallel Filter Paths Drift — Fix One, Audit the Others'
track: bug
category: logic-errors
module: server
severity: high
tags: [search-index, sql-fallback, schema-rollout, query-paths, code-review]
symptoms: [Filter works through one query path but silently no-ops through another, Cold-start / index-not-warm / bypass-flag requests return wrong filtered results, Source comment in the unfixed path reads 'this column does not exist' even though it now does]
applies_to: [server/storage/meal-plans.ts, server/storage/community.ts]
created: '2026-04-18'
---

# Parallel Filter Paths Drift — Fix One, Audit the Others

## Problem

A schema change added `mealTypes text[]` to `community_recipes` and wired the GIN-index filter into the MiniSearch query path. The community-breakfast search UI worked when MiniSearch served the response. The SQL fallback in `getUnifiedRecipes` (`server/storage/meal-plans.ts`) still hardcoded a comment reading "community recipes have no mealTypes column" and skipped the filter. Every request that missed the MiniSearch cache — cold start, index not yet warm, forced `.bypass=true` flag — returned dinner recipes for `GET /api/recipes/browse?mealType=breakfast`.

## Symptoms

- Filter UI returns correct results most of the time, wrong results some of the time
- Wrong results correlate with server cold starts or explicit cache-bypass requests
- An older code comment in the unfixed path documents the constraint that no longer holds

## Root Cause

When a schema-level feature lands — new column, new index, new relation — there are typically 2–5 places it needs to be consumed: the search-index write, the search-index read, the SQL fallback path, the migration/backfill, and sometimes a cache invalidation. A PR that wires the feature into ONE consumer passes review and passes tests because the other consumers look identical to what they were before the column existed. The tests do not exercise the slow-path consumer.

## Solution

Wire the filter into every query that touches the same table. Update or remove stale comments that claim the column doesn't exist. For this incident, the SQL fallback was updated to apply the same `array_overlap` filter as the MiniSearch path.

## Prevention

- After landing a new filter-relevant column, grep every query that touches the same table and ask: "would this query want to filter on the new column too?" The answer is usually yes — the product feature is the filter, and the filter should work everywhere.
- Treat each consumer surface as a separate change item in the PR description so reviewers can check them individually.
- Consider an integration test that exercises the slow-path (`bypass=true` or cache-cleared) version of each filter.

## Related Files

- `server/storage/meal-plans.ts:420-429` — fixed
- `docs/legacy-patterns/database.md` — "Parallel Query Path Audit" checklist candidate

## See Also

- [Protocol handler bug — fix all consumers](./protocol-handler-bug-fix-all-consumers-2026-05-13.md)
- [Feature flag routing divergence tests](../conventions/feature-flag-routing-divergence-tests-2026-05-13.md)
