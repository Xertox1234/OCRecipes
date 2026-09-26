---
title: "useNutritionLookup never resets servingSizeGrams per lookup — masked today only by an unrelated calories gate"
status: backlog
priority: low
created: 2026-09-26
updated: 2026-09-26
assignee:
labels: [deferred, hooks]
github_issue:
---

# useNutritionLookup never resets servingSizeGrams per lookup — masked today only by an unrelated calories gate

## Summary

`fetchBarcodeData`'s per-lookup reset block (`client/hooks/useNutritionLookup.ts`) now resets every state that isn't written on every exit, except `servingSizeGrams`. It's written only on the server-success, label-conflict and OFF-fallback-found exits. So a later lookup that takes the 404, OFF-not-found or total-outage exit keeps the previous product's grams.

## Background

From #1099's confirm review. It isn't visible today: every exit that skips `servingSizeGrams` also leaves `nutrition.calories` undefined, and `showServingControls = !!barcode && nutrition?.calories !== undefined` (`client/screens/NutritionDetailScreen.tsx`) hides the serving controls. That coupling is a coincidence, not enforced. A future change that puts a placeholder calorie value on one of those exits would reopen a stale-serving-size leak. The same review found that no navigation path currently changes the barcode on a mounted screen, so the whole reset block is defense in depth.

## Acceptance Criteria

- [ ] Add `setServingSizeGrams(<declared initial value>)` to the reset block at the top of `fetchBarcodeData`.
- [ ] A hook test: lookup 1 succeeds with a serving size, then lookup 2 takes a non-success exit on the same hook instance, and `servingSizeGrams` is back to its initial value. It must fail before the fix.

## Implementation Notes

- Mirror the six reset tests added in #1099 (`client/hooks/__tests__/useNutritionLookup.test.ts`, describe block "correctionNotice/isPer100g reset per lookup").
- The audit rule is in `docs/solutions/conventions/mutual-exclusion-proven-per-call-site-can-co-occur-across-invocations-2026-08-06.md` ("The reset block needs both directions").

## Scope Contract

- **Files in scope:** `client/hooks/useNutritionLookup.ts`, `client/hooks/__tests__/useNutritionLookup.test.ts`.

## Dependencies

- None
