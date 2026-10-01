---
title: "getNutritionCacheBatch gives a cache hit to only the first spelling of a shared cache key"
status: backlog
priority: medium
created: 2026-09-30
updated: 2026-09-30
assignee:
labels: [deferred, database]
github_issue:
---

# getNutritionCacheBatch gives a cache hit to only the first spelling of a shared cache key

## Summary

`getNutritionCacheBatch` (`server/storage/cache.ts`) maps each cached row back to its item with
`normalizedKeys.indexOf(entry.queryKey)`, which finds only the FIRST item with that key. When a
batch holds two spellings of one food ("sugar" and " sugar", or "Sugar"), only the first gets the
cached answer; the others miss, are fetched again from the providers, and overwrite the cache entry.

## Background

Found by the Lane B final whole-branch review (2026-09-30) while checking the R1 relation in
`server/services/__tests__/nutrition-lookup.property.test.ts` ("batch lookup equals per-item
lookup"). With a warm cache the relation fails: `lookupNutrition(" sugar")` returns the cached row
(source "cache"), while `batchNutritionLookup(["sugar", " sugar"])` answers " sugar" with a fresh
provider fetch. R1 only holds today because its db mock always misses; its header says so and
points here.

Effect: redundant provider calls (USDA / API Ninjas quota) and cache churn when a recipe's
ingredient list repeats a food with a different case or spacing. The values are usually the same,
so this is cost and consistency, not wrong nutrition.

## Acceptance Criteria

- [ ] Every item whose normalised key has a live cache row gets that row, not only the first.
- [ ] A unit test in the storage cache tests covers two spellings of one key in one batch.
- [ ] R1's header in `nutrition-lookup.property.test.ts` drops the "does not hold there today"
      sentence and the todo pointer once fixed (optionally: add a warm-cache variant of R1).

## Implementation Notes

Iterate the items instead of the rows: build `Map<queryKey, entry>` from `cached`, then for each
`i` in `items`, `const hit = byKey.get(normalizedKeys[i]); if (hit) results.set(items[i], …)`.

## Scope Contract

- **Mechanisms to use:** a key → row map inside `getNutritionCacheBatch` — nothing new.
- **Files in scope:** `server/storage/cache.ts`, its test file under `server/storage/__tests__/`,
  and the R1 header in `server/services/__tests__/nutrition-lookup.property.test.ts`.
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None.

## Risks

- None known; callers already accept any subset of items as hits.

## Updates

### 2026-09-30

- Initial creation (Lane B final review finding; auto-filed as medium).
