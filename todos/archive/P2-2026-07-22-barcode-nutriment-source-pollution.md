---
title: "Barcode lookup returns wrong per-100g nutriments for some products (source pollution)"
status: done
priority: medium
created: 2026-07-22
updated: 2026-07-24
assignee:
labels: [bug, nutrition, data-quality, barcode]
github_issue:
---

# Barcode lookup returns wrong per-100g nutriments for some products (source pollution)

## Summary

`GET /api/nutrition/barcode/:code` returns **incorrect per-100g nutriment values** for at least some barcodes — the wrong product's macros are surfaced while the OFF product-level fields (name, NOVA, Nutri-Score) are correct. Users see wrong calories/sugar/fat, and (post PR #694) the FSA nutrient flags silently mis-fire because they evaluate the polluted data.

## Background

Found during live runtime verification of the Smart Scan universal-flags feature (PR #694), NOT caused by it — the wrong values are in the pre-existing `calories/protein/carbs/fat/sugar/sodium` fields, which that PR did not touch (its 53 existing barcode-lookup tests are green).

**Reproduction (2026-07-22, local dev server, live OFF):**

- Barcode `3017620422003` (Nutella). `productName: "Nutella"`, `novaGroup: 4`, `nutriScore: "e"` — all correct (OFF product-level).
- But `per100g` = `{ calories: 182, protein: 17.3, carbs: 16.8, fat: 4.6, fiber: 0.9, sugar: 3.1, sodium: 427 }`.
- Real Nutella is ~539 kcal, ~57g sugar, ~30g fat, ~10.6g sat-fat, ~6g protein per 100g. The returned values (high protein 17.3, low sugar 3.1) look like a **different product entirely** — a similarity/name match, not the barcode's own label.

Consequence for PR #694's flags: Nutella returns only `processing:ultra` + `nutriscore:e` — no `nutrient:sugar` despite being a very-high-sugar product — because the evaluator correctly evaluated the wrong `sugar: 3.1`.

This matches a recently codified bug class: `docs/solutions/logic-errors/name-matched-secondary-must-not-replace-self-consistent-label-2026-07-17.md` ("A similarity-matched secondary source must never replace identity-matched, self-consistent label data"). Either that fix does not cover this path, or a regression/new path was introduced.

## Acceptance Criteria

- [x] Identify WHERE the wrong nutriments for `3017620422003` originate: is OFF (identity/barcode match) returning them, or is a secondary source (CNF/USDA/API-Ninjas name-search) replacing/merging over OFF's self-consistent label data in `reconcilePer100g`? → **Secondary replacement.** Live OFF returns Nutella's per-100g correctly (539 kcal, 56.3g sugar) but with NO `serving_size` / per-serving energy; `offSelfConsistent` bailed on its first guard, so a CNF category name-match (182 kcal) replaced OFF wholesale in `reconcilePer100g` (`preferSecondaryOnDiscrepancy` true).
- [x] Characterize the blast radius: is this one bad barcode, or a systematic reconcile/fallback issue? → **Systematic**, not one barcode: any OFF entry lacking per-serving energy (most of OFF) + self-consistent macros + a disagreeing (>2×) name-matched secondary. Mechanism identified and fixed at the root, not per-barcode. (Live 10-barcode spot-check not run — hits live external APIs + needs an auth token; the mechanism-level characterization + regression fixtures cover the AC.)
- [x] Ensure an identity-matched (barcode) label source with self-consistent macros is NOT overwritten by a name/similarity-matched secondary source. → Added a **second self-consistency path** to `offSelfConsistent`: Atwater energy-vs-own-macros corroboration (`offMacrosCorroborateEnergy`, `4p+4c+9f` vs stated energy, 30% tolerance), active only when per-serving energy is absent → demotes the secondary to gap-fill. Extends the codified `name-matched-secondary-must-not-replace-self-consistent-label` rule.
- [x] Add a regression test pinning `3017620422003` to Nutella's real macro ballpark. → Added an integration regression (Nutella kept at 539 / sugar 56.3, source `openfoodfacts+self-consistent`), direct `offMacrosCorroborateEnergy` unit tests (guards + 30% boundary), and a widened-shield tradeoff pin.
- [x] Confirm PR #694's FSA nutrient flags then fire correctly for the fixed data (high-sugar Nutella → `nutrient:sugar`). → Added a `universal-flags.test.ts` case: corrected per-100g (sugar 56.3 > FSA_FOOD.sugar 22.5) fires `nutrient:sugar` alongside `processing:ultra` + `nutriscore:e`.

## Implementation Notes

- Primary suspects: `server/services/barcode-lookup.ts` (`lookupBarcode`, `reconcilePer100g` — OFF-first fetch then CNF/USDA merge) and `server/services/nutrition-lookup.ts` (fallback order CNF → USDA → API Ninjas; name-search path). The OFF product-level extraction being correct while nutriments are wrong points at the reconcile/secondary-merge step, not the OFF fetch itself.
- Reproduce locally: `npm run server:dev` (NODE_ENV=development), login (demo/demo123), `curl -s localhost:3000/api/nutrition/barcode/3017620422003 -H "Authorization: Bearer <token>"` and inspect `per100g` + `servingInfo` + `isServingDataTrusted`. Log which source each field came from through the reconcile.
- Do NOT touch auth/JWT while investigating (health/auth is a no-delegate zone).
- Note: `isServingDataTrusted` was `false` for this barcode (serving defaulted to 100g) — check whether the serving/source confusion and the nutriment pollution share a root cause.

## Updates

### 2026-07-24

- **Root cause (confirmed via live OFF):** OFF returns Nutella's per-100g correctly and completely (539 kcal, 6.3 protein, 57.5 carbs, 30.9 fat, 56.3 sugar) but the entry has NO `serving_size` and NO per-serving energy. The `offSelfConsistent` gate's first guard was `if (offPerServingCal === undefined … ) return false`, so it bailed → `preferSecondaryOnDiscrepancy = true` → a CNF category name-match ("spreads", 182 kcal, a different food) replaced OFF's identity-matched data wholesale (`source: "cnf"`). The 7-field output shape (no `saturatedFat`/`transFat`/…) is the fingerprint of `normalizeToPerHundredGrams(secondary)`. The `isServingDataTrusted: false` observation shares the same root: no `serving_size` → both the per-serving self-consistency check couldn't run AND serving defaulted to 100g.
- **Fix:** `server/services/barcode-lookup.ts` — added exported pure helper `offMacrosCorroborateEnergy` + `ATWATER_MACRO_TOLERANCE = 0.3`; restructured the `offSelfConsistent` opening guard so that when per-serving energy is absent it falls back to Atwater energy-vs-own-macros corroboration instead of returning false. All existing per-serving / zero-agreement / kJ-contradiction branches are byte-preserved (they only run when both `offPerServingCal` and `offPer100g.calories` are defined). Fiber deliberately excluded (OFF mixes EU/US carb conventions → ignoring is minimax-robust; documented in code).
- **Tests:** two pre-existing "wrong sugar" fixtures (in `barcode-lookup.test.ts` + `nutrition-lookup.test.ts`) had unrealistic `carbohydrates_100g: 12` (Atwater-consistent with the wrong 50 kcal) → changed to `100` so they stay genuinely-wrong (rescue preserved); added Nutella integration regression, `offMacrosCorroborateEnergy` unit block (guards + 30% boundary), a widened-shield tradeoff pin, and a `universal-flags.test.ts` FSA `nutrient:sugar` case. Full suite green (470 files / 6799 tests).
- **Review:** code-reviewer + ai-reviewer + server-reviewer — zero CRITICAL, zero regressions; branch-preservation and provenance-rank invariants confirmed; Nutella regression verified non-vacuous. All findings addressed.
- **Follow-ups filed:** `todos/P2-2026-07-24-barcode-cache-poisoned-rows-remediation.md` (human-executed prod cache sweep — first-write-wins rows don't self-heal) and `todos/P3-2026-07-24-atwater-fallback-when-serving-grams-unparseable.md` (extend the Atwater path to per-serving-present-but-grams-unparseable entries).
