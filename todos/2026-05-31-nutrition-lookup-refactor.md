---
title: "Refactor nutrition-lookup.ts: extract reconciliation helper + barcode domain split"
status: backlog
priority: low
created: 2026-05-31
updated: 2026-05-31
assignee:
labels: [deferred, architecture, code-quality]
github_issue:
---

# Refactor nutrition-lookup.ts: extract reconciliation helper + barcode domain split

## Summary

`server/services/nutrition-lookup.ts` (1253 lines) has three structural issues found in the 2026-05-31 code-quality audit: a 310-line 3-branch reconciliation tangle in `lookupBarcode` with duplicated gap-fill logic, an identical USDA nutrient mapping duplicated across two functions, and a single file that houses two distinct domains (name-based lookup and barcode lookup). These are all structural opportunities in the same file — worth tackling together.

## Background

Surfaced by `/audit code-quality` on 2026-05-31. Three findings:

**H2 — lookupBarcode reconciliation tangle** (`nutrition-lookup.ts:1021–1095`):
The `lookupBarcode` function's Step 4 has three overlapping branches (USDA-UPC-primary, OFF-with-discrepancy, OFF-no-calories). Each branch manually re-assembles a `BarcodePer100g` object using `??` chains for gap-filling. The ratio-comparison (`ratio < 0.5 || ratio > 2.0`) and gap-fill object literal appear identically in both the USDA branch (line 1040) and the OFF branch (line 1062).

**M5 — duplicate USDA nutrient mapping** (`nutrition-lookup.ts:504–523,571–591`):
`lookupUSDA` and `lookupUSDAByUPC` each define an inline `findNutrient` closure and build an identical 7-field `NutritionData` object. The only difference: `lookupUSDA` uses `n.value || 0` while `lookupUSDAByUPC` uses `n.value` (the `|| 0` is redundant given upstream `.transform((v) => v ?? 0)` in the Zod schema).

**L6 — mixed domains in one file** (`nutrition-lookup.ts:685–1160`):
Lines 685–1160 (~570 lines) contain the barcode domain: `lookupBarcode`, `barcodeVariants`, `computeUPCA`, `computeEAN13`, `normalizeToPerHundredGrams`, `scaleNutrients`, `estimateServingGrams`, `parseServingGrams`. The name-based lookup and barcode lookup are conceptually separate — the barcode path _uses_ the name lookup as a building block. Splitting into `barcode-lookup.ts` makes the dependency direction explicit and gives each domain a focused test surface.

## Acceptance Criteria

- [ ] Extract a `reconcilePer100g(primary: BarcodePer100g | null, secondary: BarcodePer100g | null, secondarySource: string): { per100g: BarcodePer100g; source: string }` helper function; the three Step-4 branches collapse to a single `reconcilePer100g` call; the gap-fill `??` object literal appears exactly once
- [ ] Extract a module-level `mapUsdaFoodToNutrition` helper; both `lookupUSDA` and `lookupUSDAByUPC` use it; the redundant `|| 0` in `lookupUSDA` is removed; the duplicate `findNutrient` closure is deleted
- [ ] Extract `server/services/barcode-lookup.ts` containing: `lookupBarcode`, `barcodeVariants`, `computeUPCA`, `computeEAN13`, `normalizeToPerHundredGrams`, `scaleNutrients`, `estimateServingGrams`, `parseServingGrams`; it imports `lookupNutrition` / `cacheNutrition` from `nutrition-lookup.ts`
- [ ] `nutrition-lookup.ts` drops below 700 lines after the split
- [ ] All callers of `lookupBarcode` are updated to import from `barcode-lookup.ts`; `nutrition-lookup.ts` no longer exports it
- [ ] All existing tests pass; behaviour is unchanged

## Implementation Notes

Do these three extractions in order to avoid merge conflicts:

1. Extract `mapUsdaFoodToNutrition` helper (M5) — small, self-contained
2. Extract `reconcilePer100g` helper (H2) — test thoroughly against the three reconciliation branches
3. Split into `barcode-lookup.ts` (L6) — move the functions listed above; update imports across the codebase

Use LSP `findReferences` on `lookupBarcode` before the split to find all import sites.

The `mapLabelToNutritionData` and `countNonNullNutritionFields` helpers (lines 1165–1213) operate on `NutritionData` values — they stay in `nutrition-lookup.ts`, not `barcode-lookup.ts`.

The split is mechanical refactoring with no behavior change. The reconciliation helper extraction is where correctness risk lives — verify the three branch outcomes independently with unit tests before and after.

## Dependencies

- None (no pending schema or API changes block this)

## Risks

- `lookupBarcode` is called from route handlers; LSP findReferences confirms callers before moving the export
- The reconciliation logic has subtle semantics (calorie ratio thresholds, gap-fill priority order) — unit tests are essential before and after extraction

## Updates

### 2026-05-31

- Created from `/audit code-quality` 2026-05-31 findings H2, M5, L6
