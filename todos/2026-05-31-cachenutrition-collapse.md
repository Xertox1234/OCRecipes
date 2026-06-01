---
title: "Collapse cacheNutrition + cacheNutritionIfAbsent into one writer"
status: backlog
priority: low
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [deferred, maintainability]
github_issue:
---

# Collapse cacheNutrition + cacheNutritionIfAbsent

## Summary

`cacheNutrition` and `cacheNutritionIfAbsent` in `nutrition-lookup.ts` are near-identical — both `normalizeForCache(query)`, build `expiresAt`, call storage, and catch with nearly identical logs. They differ only in the storage method and the log label. Collapse to one `writeNutritionCache(query, data, { allowOverwrite })`.

## Background

Found in the 2026-05-31 code-quality re-run (maintainability L6). ~18 duplicated lines.

## Acceptance Criteria

- [ ] Add `writeNutritionCache(query, data, { allowOverwrite: boolean })` that selects `setNutritionCache` vs `setNutritionCacheIfAbsent` from the flag
- [ ] Replace the two functions (`nutrition-lookup.ts:171-189` and `:763-781`)
- [ ] Update the 5 internal callers (lines ~640/647/654/687) + the 1 external route caller in `photos.ts` to pass `allowOverwrite`
- [ ] Preserve both log labels (`"cache write error"` / `"cache seed write error"`) — pass the label or derive from the flag
- [ ] Existing nutrition-lookup tests pass

## Implementation Notes

- Keep error-handling behavior identical (catch + log, don't throw — cache writes are best-effort).
- This file was recently split (`barcode-lookup.ts`, PR #298); confirm both functions still live in `nutrition-lookup.ts` after the split before editing.

## Risks

- Low — best-effort cache writes; no correctness path. Verify the `allowOverwrite=false` callers still map to `setNutritionCacheIfAbsent`.

## Updates

### 2026-05-31

- Filed from the 2026-05-31 code-quality re-run, manifest L6.
