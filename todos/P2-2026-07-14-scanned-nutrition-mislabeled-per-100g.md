<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Nutrition detail screen mislabels correctly-scaled values as 'per 100g'"
status: backlog
priority: medium
created: 2026-07-14
updated: 2026-07-14
assignee:
labels: [nutrition, barcode, bug]
github_issue:

---

# Nutrition detail screen mislabels correctly-scaled values as "per 100g"

## Summary

After a barcode scan (e.g. Coca-Cola Cherry Coke, serving size 355 ml), the Nutrition Detail screen shows the "355 ml" serving-size chip as selected and displays 82 calories — but the calorie hero card is labeled "Calories (per 100g)" and a banner reads "Values shown per 100g. Check package for actual serving size." Both are wrong: the 82 is already scaled to the real 355 ml serving via `scaleNutrients`, not a raw per-100g value. The mislabeling makes correct data look untrustworthy/wrong to the user.

## Background

Reported by the user while testing the scan camera overhaul (PR #620/#623): "the serving size remains at 100 grams despite the nutrition label serving size of per can 355ml." Investigation (see Implementation Notes) found the _value_ is actually already correct — this is a labeling/trust bug, not a scaling bug, which changes the fix's scope and risk significantly from what the symptom suggests.

## Acceptance Criteria

- [ ] `isPer100g` (or its server-side source, `isServingDataTrusted`) reflects whether serving-size data actually exists and was used to scale the displayed values — not whether a secondary source (CNF/USDA) happened to cross-validate the calorie count
- [ ] When a product has a real serving size (e.g. "355 ml") and the displayed values were scaled to it, the UI does NOT show "(per 100g)" or the "Check package" banner
- [ ] The "(per 100g)"/"Check package" treatment is reserved for products that genuinely lack serving-size data (only raw per-100g nutriments available)
- [ ] Regression test: a product whose serving data fails CNF/USDA cross-validation but still has a real serving size (the Cherry Coke case) shows the scaled value with no "per 100g" label
- [ ] Regression test: a product with no serving-size data at all still correctly shows the "per 100g"/"Check package" treatment (don't lose the legitimate case)

## Implementation Notes

Root cause (traced, not guessed — see the research below):

- **UI**: `client/screens/NutritionDetailScreen.tsx` — calorie hero card (~line 439-450: `Calories{isPer100g ? " (per 100g)" : ""}`) and the "Check package" banner (~line 453-465), both gated on `isPer100g`.
- **Client state**: `client/hooks/useNutritionLookup.ts` line ~218-220: `setIsPer100g(!data.isServingDataTrusted && !data.servingInfo.wasCorrected)`.
- **Server, the actual bug**: `server/services/barcode-lookup.ts` line ~538: `isServingDataTrusted: !wasCorrected && source.includes("verified")`. `source` only contains `"verified"` when `reconcilePer100g` (lines ~138-190) cross-validates the calorie count against a secondary source within a ratio tolerance — this is an unrelated signal from "do we actually have/use real serving-size data." Most branded products fail this cross-validation, so `isServingDataTrusted` ends up `false` even when `perServing` (line ~233, via `scaleNutrients(per100g, scale)` at lines ~502-529) was already correctly computed from the real serving size.
- **Documented intent that's drifted**: `docs/solutions/conventions/indicate-data-source-to-users-2026-05-13.md` ties the original intent to `hasServingData = nutriments["energy-kcal_serving"] !== undefined` — i.e., "does the source explicitly give us a per-serving value" — not cross-validation success. The current server logic diverged from this documented convention; that solution doc is the reference for what "correct" should look like.
- Likely fix shape: decouple the "is this per-100g-only" flag from `source.includes("verified")`; drive it instead from whether real serving-size data was present/used for scaling (independent of whether a secondary source happened to corroborate the calorie count).
- Separately (lower priority, may be its own todo): the camera-OCR nutrition-label flow (`ScanScreen.tsx` line ~205) currently drops the OCR-parsed serving size entirely — `scanPhase`'s `ocrText` never reaches `NutritionDetail`'s navigation params (`navigation.navigate("NutritionDetail", { barcode })`, only `barcode` is passed). The `imageUri`-only path in `useNutritionLookup.ts` (~line 419-424) sets a placeholder `{ productName: "Manual Entry", servingSize: "1 serving" }` with no calories, so `ServingControls` doesn't even render for that path. This todo is scoped to the barcode-lookup mislabeling only; the OCR-serving-size-discarded gap is a separate, deeper change (wiring OCR-parsed nutrition data through to the detail screen at all) and should be filed separately if prioritized.

## Dependencies

- None known

## Risks

- The `isServingDataTrusted`/`isPer100g` flag may be relied on elsewhere (e.g. logging, analytics, or a different UI surface) — grep all consumers before changing its derivation, not just `NutritionDetailScreen.tsx`
- Changing the cross-validation-based `source.includes("verified")` check could have been an intentional (if now-undocumented) proxy for "do we trust this serving size" in some edge case — verify with `git blame`/`git log` on `barcode-lookup.ts` before assuming it's purely accidental drift

## Updates

### 2026-07-14

- Filed after user testing surfaced the mislabeling during scan-camera-overhaul verification; root cause traced via code research, not yet fixed
