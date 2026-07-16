<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "USDA-by-UPC barcode branch hardcodes 100g serving, discarding real USDA per-serving data"
status: done
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

- [x] Investigate whether USDA's branded-food-by-UPC API response includes usable per-serving-size fields (e.g. `servingSize`, `servingSizeUnit`, `householdServingFullText`)
- [x] If real serving data is available, wire it through `mapUsdaFoodToNutrition` and the USDA-by-UPC branch in `barcode-lookup.ts` so this path can show a correctly-scaled serving (with `isServingDataTrusted` reflecting that) instead of always defaulting to per-100g
- [x] Add a regression test covering a USDA-by-UPC match with real per-serving data

## Implementation Notes

Relevant code: `server/services/nutrition-lookup.ts` `mapUsdaFoodToNutrition` (~lines 534-558), `server/services/barcode-lookup.ts` USDA-by-UPC branch (~lines 439-464). Low priority — this is a "show better data" enhancement, not a correctness fix; the current per-100g fallback for this path is honest (not mislabeled), just less informative than it could be.

## Dependencies

- None known

## Risks

- Low — no user-facing incorrectness today; risk is scoped to whatever new serving-size parsing logic gets added

## Updates

### 2026-07-16

- Filed during review of P2-2026-07-14-scanned-nutrition-mislabeled-per-100g; surfaced by ai-reviewer as an out-of-scope SUGGESTION
- Fixed via `/todo`. Confirmed live against the real USDA FoodData Central API (not just fixtures): branded/UPC search responses do include `servingSize` (number), `servingSizeUnit` (GDSN abbreviations like "GRM"/"MLT", sometimes plain "g"/"ml"), and `householdServingFullText`. Wired through `servingSize`+`servingSizeUnit` only (via new `usdaLabelServingSize`/`normalizeUsdaServingUnit` helpers in `nutrition-lookup.ts`, recognizing only g/GRM and ml/MLT — any other unit, e.g. "MG"/"OZ", seen in real USDA data, is treated as absent rather than guess-converted). Deliberately skipped `householdServingFullText` — it's sometimes unit-free ("1 CAN"), which would show a serving-looking label while values stay scaled at the per-100g default.
- **AC2 deviation**: did NOT thread the real serving size through `mapUsdaFoodToNutrition`'s `NutritionData.servingSize` field as the Implementation Notes literally suggested. That field is the normalization denominator consumed by `normalizeToPerHundredGrams` elsewhere — repurposing it would have silently corrupted per-100g math for every `NutritionData` consumer, not just this branch. Instead, `lookupUSDAByUPC` returns a new sibling field `labelServingSize?: string`, and `barcode-lookup.ts`'s `rawServing` (already the single source `isServingDataTrusted`/`servingInfo`/scaling all derive from) is reassigned from it in the USDA-by-UPC branch. The actual criterion — a correctly-scaled, trusted serving instead of the per-100g default — is met.
- **CRITICAL found in review (ai-reviewer) and fixed**: the fire-and-forget `insertBarcodeNutritionIfAbsent` write persisted `calories`/`protein`/`carbs`/`fat` from `per100g` (per-100g values) while `servingSize` could now be a real per-serving label — a 3.33x calorie overstatement for e.g. a 30g serving at 400 kcal/100g. Previously dormant for the USDA-by-UPC branch specifically (rawServing was always `""`, falling back to `${finalGrams}g`="100g", which happened to match the per100g denominator). Fixed by hoisting `perServing = scaleNutrients(per100g, scale)` before the write and using it for both the write and the returned result. **Scope expansion**: this fix changes the OFF branch's write too (not just USDA-UPC) — any product with a real OFF `serving_size` now correctly gets a per-serving write instead of per-100g.
- **Second bug found via advisor trace, fixed before it shipped**: the `wasCorrected` (implausible-serving) path never reassigned `rawServing`, so the storage write paired the STALE pre-correction label (e.g. "236g") with the CORRECTED per-serving values (scaled to ~15g) — understating calories ~15x relative to the row's own label. Fixed: `servingSize` in the storage write now uses `${finalGrams}g` (no `~`/estimated marker, to stay parseable) whenever `wasCorrected` is true.
- Added 5 new regression tests to `server/services/__tests__/nutrition-lookup.test.ts`'s `describe("lookupBarcode", ...)` block: happy path (real USDA serving, correctly scaled + trusted, storage write asserted), unsupported-unit skip (OZ), malformed/wrong-typed `servingSize` doesn't drop the whole food (schema `.catch(undefined)` regression guard), plus a storage-write coherence assertion added to the pre-existing multi-pack correction test. All existing tests (barcode-lookup.test.ts + nutrition-lookup.test.ts, 38 total) still pass.
- Reviewed by `code-reviewer` + `ai-reviewer`, 2 rounds. Round 1: code-reviewer WARNING (shared db mock missing `onConflictDoNothing`, silently swallowing the fire-and-forget write — fixed, extends the existing `docs/solutions/code-quality/incomplete-mock-swallowed-by-fire-and-forget-catch-2026-07-16.md` gap into this file too) + ai-reviewer CRITICAL (above). Round 2: both reviewers confirmed the fixes; code-reviewer flagged a follow-up WARNING (the new test didn't actually pin the macro-value fix, only `servingSize` — fixed by asserting calories/protein/carbs/fat too).
- **DEFERRED (not fixed, surfaced for the user)**: pre-existing `barcode_nutrition` rows written before this fix may already carry per-100g macro values under a real per-serving `servingSize` label (the OFF branch had this bug since long before this todo, whenever calories didn't coincidentally equal the per-100g value). Because the insert is first-write-wins (`onConflictDoNothing`), a rescan will NOT self-heal an existing bad row. This is the free/unverified tier only (the paid `barcodeVerification` tier uses an independent consensus pipeline). Needs a human decision: identify + remediate affected rows (e.g. delete rows whose `servingSize` doesn't parse to ~100g/100ml so the next scan repopulates correctly), or leave as historical drift.
- **Non-blocking environment note**: `npm run test:run` in this worktree has one pre-existing failure (`server/lib/__tests__/error-reporter.test.ts`'s Sentry-source-drift guard, ENOENT) — verified as a worktree-only artifact (this worktree's `node_modules` is nearly empty; Node's ancestor walk-up to the main checkout covers ordinary imports, but this one test builds a `cwd`-anchored explicit file path). Confirmed passing when run from the main checkout. Unrelated to this diff; every todo-executor worktree would hit it.
