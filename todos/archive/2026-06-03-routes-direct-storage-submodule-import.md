---
title: "Fix cooking.ts and meal-plan.ts direct storage sub-module imports"
status: done
priority: low
created: 2026-06-03
updated: 2026-06-03
assignee:
labels: [deferred, architecture]
github_issue:
---

# Fix cooking.ts and meal-plan.ts direct storage sub-module imports

## Summary

`cooking.ts:6` and `meal-plan.ts:6` import `incrementRecipePopularity` directly from `../storage/canonical-recipes` instead of through the facade at `../storage`. The function is correctly exposed on the facade; direct sub-module import breaks the facade-as-public-API invariant.

## Background

Deferred from 2026-06-03 full audit (L6). Files: `server/routes/cooking.ts:6`, `server/routes/meal-plan.ts:6`.

## Acceptance Criteria

- [ ] `cooking.ts` imports `incrementRecipePopularity` from `../storage`
- [ ] `meal-plan.ts` imports `incrementRecipePopularity` from `../storage`
- [ ] No other direct sub-module storage imports in these files

## Implementation Notes

Two one-line import changes. Confirm `incrementRecipePopularity` is re-exported from `server/storage/index.ts` (should already be there per the finding).

## Dependencies

- None

## Risks

- None — facade re-exports the same function

## Updates

### 2026-06-03

- Initial creation (deferred from full audit L6)
