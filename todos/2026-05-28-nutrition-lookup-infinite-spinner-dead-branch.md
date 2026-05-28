---
title: "useNutritionLookup can hang on a permanent spinner if the itemId query fails (latent)"
status: backlog
priority: low
created: 2026-05-28
updated: 2026-05-28
assignee:
labels: [deferred, client-state]
github_issue:
---

# useNutritionLookup can hang on a permanent spinner if the itemId query fails (latent)

## Summary

In `useNutritionLookup`, when `itemId` is provided and the `existingItem` query fails, no branch of the resolution effect fires and `isLoading` never clears — producing a permanent spinner with no error and no retry. **Latent today** because nothing currently passes `itemId` to `NutritionDetail`.

## Background

Found during the 2026-05-28 silent-failure investigation. It is unreachable in practice right now: the only callers of `NutritionDetail` (ScanScreen and the `nutrition/:barcode` deep link) pass `barcode`, never `itemId`, and `useNutritionLookup` is consumed only by `NutritionDetailScreen`. History's item-detail navigation goes to `ItemDetailScreen` instead, which handles errors correctly. The branch becomes a live silent failure the moment any flow navigates to `NutritionDetail` with `itemId` (e.g. a future "re-open a logged item" entry point).

## Acceptance Criteria

- [ ] When `itemId` is set and the `existingItem` query errors, `isLoading` is cleared and an error is surfaced (the hook already has an `error` state and `NutritionDetailScreen:339` already renders it).
- [ ] No code path through the resolution effect can leave `isLoading === true` indefinitely.

## Implementation Notes

- `client/hooks/useNutritionLookup.ts:56` — `isLoading` initializes `true`.
- Lines 155-158 — the `existingItem` query destructures `data`-only; also read `isError`/`error`.
- Lines 386-405 — the `if (existingItem) … else if (barcode) … else if (imageUri) … else if (!itemId)` chain has no terminal branch for "itemId set but query failed". Add an else/error path that calls `setError(...)` + `setIsLoading(false)`.

## Dependencies

- None.

## Risks

- Low / latent. Surgical guard; no behavior change for current (barcode-only) callers.

## Updates

### 2026-05-28

- Initial creation. Dead branch verified by reading lines 56, 155-158, 386-405; reachability ruled out by grepping all `NutritionDetail` callers (none pass `itemId`).
