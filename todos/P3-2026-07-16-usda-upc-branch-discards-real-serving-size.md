<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "USDA-by-UPC barcode branch hardcodes 100g serving, discarding real USDA per-serving data"
status: backlog
priority: low
created: 2026-07-16
updated: 2026-07-16
assignee:
labels: [deferred, nutrition, barcode]
github_issue:

---

# USDA-by-UPC barcode branch hardcodes 100g serving, discarding real USDA per-serving data

## Summary

When Open Food Facts has no product for a barcode but USDA's branded-food-by-UPC lookup finds a match, `server/services/barcode-lookup.ts`'s USDA-by-UPC branch always falls back to displaying per-100g values (`rawServing` is always `""` in this path, so `isServingDataTrusted` is always `false` and `finalGrams` defaults to 100). This is accurate today (nothing is mislabeled), but `mapUsdaFoodToNutrition` (`server/services/nutrition-lookup.ts`) hardcodes `servingSize: "100g"` regardless of whether USDA's branded/UPC-matched food record actually has real per-serving metadata, discarding data that could show a correctly-scaled serving instead of per-100g.

## Background

Surfaced by the `ai-reviewer` during review of P2-2026-07-14-scanned-nutrition-mislabeled-per-100g (the `isServingDataTrusted` mislabeling fix), while tracing every path through `lookupBarcode` to confirm the fix's new derivation didn't regress any branch. This branch was already correctly labeled before and after that fix — it's a missed enhancement opportunity, not a bug.

## Acceptance Criteria

- [ ] Investigate whether USDA's branded-food-by-UPC API response includes usable per-serving-size fields (e.g. `servingSize`, `servingSizeUnit`, `householdServingFullText`)
- [ ] If real serving data is available, wire it through `mapUsdaFoodToNutrition` and the USDA-by-UPC branch in `barcode-lookup.ts` so this path can show a correctly-scaled serving (with `isServingDataTrusted` reflecting that) instead of always defaulting to per-100g
- [ ] Add a regression test covering a USDA-by-UPC match with real per-serving data

## Implementation Notes

Relevant code: `server/services/nutrition-lookup.ts` `mapUsdaFoodToNutrition` (~lines 534-558), `server/services/barcode-lookup.ts` USDA-by-UPC branch (~lines 439-464). Low priority — this is a "show better data" enhancement, not a correctness fix; the current per-100g fallback for this path is honest (not mislabeled), just less informative than it could be.

## Dependencies

- None known

## Risks

- Low — no user-facing incorrectness today; risk is scoped to whatever new serving-size parsing logic gets added

## Updates

### 2026-07-16

- Filed during review of P2-2026-07-14-scanned-nutrition-mislabeled-per-100g; surfaced by ai-reviewer as an out-of-scope SUGGESTION
