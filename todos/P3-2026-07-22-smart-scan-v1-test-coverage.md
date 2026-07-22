---
title: "Smart Scan v1 — close universal-flags test-coverage gaps"
status: backlog
priority: low
created: 2026-07-22
updated: 2026-07-22
assignee:
labels: [deferred, testing, scan]
github_issue:
---

# Smart Scan v1 — close universal-flags test-coverage gaps

## Summary

Add regression tests for a few correct-by-inspection paths in the Smart Scan universal-flags feature (PR #694) that shipped without direct coverage. All are Minor gaps surfaced by the per-task and whole-branch reviews — no known defect, just missing regression guards.

## Background

The v1 feature was built strict-TDD, but a handful of branches are verified only by code-reading (the brief's literal test lists didn't cover them). Deferred to keep each task scoped; batched here.

## Acceptance Criteria

- [ ] `barcode-lookup.test.ts`: test the `caffeine_unit === "mg"` branch (OFF reports caffeine already in mg → no ×1000) and the missing→`undefined` direction for the OFF nutriment mapping.
- [ ] `barcode-lookup.test.ts`: lock the Zod schema-deviation safety property — `offNutrimentsSchema.parse({ "trans-fat_100g": "N/A", proteins_100g: 5 })` keeps `proteins_100g === 5` (a garbage value on one OFF key must not wipe sibling nutriments).
- [ ] `barcode-lookup.test.ts`: cover the 4 new fields' gap-fill lines in `reconcilePer100g` (satFat/transFat/cholesterol/caffeine `primary ?? secondary`).
- [ ] `universal-flags.test.ts` (sweeteners): the E951 test also asserts `tier === "nutrition"` (guards against an `"insight"` regression).
- [ ] `NutritionDetailScreen.test.tsx`: assert the rendered value+unit text (`"0.4 g"`, `"95 mg"`) for the new nutrient rows, not just the row labels — locks the `roundToOneDecimal` wiring end-to-end.

## Implementation Notes

Files: `server/services/__tests__/barcode-lookup.test.ts`, `server/services/__tests__/universal-flags.test.ts`, `client/screens/__tests__/NutritionDetailScreen.test.tsx`. Use the existing OFF-mock harness (`setupFetchMock` + `_resetCNFCacheForTesting`) and `renderComponent` for the screen test. Pure test additions — no source changes expected.
