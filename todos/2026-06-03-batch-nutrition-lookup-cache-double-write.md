---
title: "Fix batchNutritionLookup double cache-check and double cache-write"
status: backlog
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, performance, data-integrity]
github_issue:
---

# Fix batchNutritionLookup double cache-check and double cache-write

## Summary

`batchNutritionLookup` calls `lookupNutrition()` per uncached item, but `lookupNutrition` starts with a guaranteed-miss `getCachedNutrition` per-item query (the batch already proved it was a miss) and then double-writes to cache. This produces N extra single-row DB reads + 2N writes for every uncached batch.

## Background

Deferred from 2026-06-03 full audit (M1). The batch function at `server/services/nutrition-lookup.ts:641-716` does a batch cache check, then for uncached items calls the per-item `lookupNutrition` which re-checks the cache individually and writes back. This is redundant work that scales linearly with uncached batch size.

## Acceptance Criteria

- [ ] `batchNutritionLookup` passes already-fetched nutrition data directly to uncached items without re-querying cache
- [ ] Cache writes for batch results happen once per item (not twice)
- [ ] Existing nutrition batch tests still pass

## Implementation Notes

File: `server/services/nutrition-lookup.ts:641-716`. Refactor to extract the fetch/API call logic from `lookupNutrition` into a lower-level function that skips the cache check and write, callable from both the single and batch paths.

## Dependencies

- None

## Risks

- Subtle logic change in cache-miss detection; test the batch + single-item paths together

## Updates

### 2026-06-03

- Initial creation (deferred from full audit M1)
