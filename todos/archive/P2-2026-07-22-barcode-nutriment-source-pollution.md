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

- [x] Identify WHERE the wrong nutriments for `3017620422003` originate: is OFF (identity/barcode match) returning them, or is a secondary source (CNF/USDA/API-Ninjas name-search) replacing/merging over OFF's self-consistent label data in `reconcilePer100g`?
- [x] Characterize the blast radius: is this one bad barcode, or a systematic reconcile/fallback issue? (Spot-check ~10 well-known barcodes: server per-100g vs the product's real label.)
- [x] Ensure an identity-matched (barcode) label source with self-consistent macros is NOT overwritten by a name/similarity-matched secondary source (apply/extend the codified `name-matched-secondary-must-not-replace-self-consistent-label` rule).
- [x] Add a regression test pinning `3017620422003` (or a representative fixture) to Nutella's real macro ballpark, or asserting the reconcile prefers the identity-matched label.
- [x] Confirm PR #694's FSA nutrient flags then fire correctly for the fixed data (high-sugar Nutella → `nutrient:sugar`).

## Outcome (2026-07-24)

**Root cause — a gate coverage hole, not bad OFF data.** OFF returns Nutella's
per-100g block correctly (539 kcal, 56.3 g sugar, 30.9 g fat, 10.6 g sat-fat)
but carries **no `serving_size` and no `energy-kcal_serving`**. The
`offSelfConsistent` gate from the 2026-07-17 fix requires per-serving energy, so
it returned `false` on its first line, `preferSecondaryOnDiscrepancy` stayed
true, and a CNF name match at 182 kcal (539/182 ≈ 2.96×, past the 2.0 threshold)
replaced the whole block. The **400 g sibling SKU** `3017620425035` has identical
macros plus a serving size and was always correct — trust depended on which jar
you scanned. The same missing `serving_size` also explains the reported
`isServingDataTrusted: false`: one field, two symptoms.

**Blast radius.** A live 15-barcode probe: 14 resolved in OFF, 13 already
shielded, 1 (`3017620422003`) not. Adding macro↔energy coherence shields 14/14.
That sample is famous European products — OFF's best-maintained entries — so the
obscure/US long tail, where `serving_size` coverage is materially worse, is
wider than 1/14 suggests.

**Fix.** `offMacrosCohereWithEnergy` in `server/services/barcode-lookup.ts` —
Atwater coherence (4·P + 4·C + 9·F ≈ kcal/100g) with an asymmetrically-clamped
fiber band, consulted **only** where the per-serving path yields no verdict.
Fallback, not OR: a detected contradiction outranks a passed coherence check, so
the garbage-entry rescue arm survives intact.

**Verified live** (dev server, real OFF): `per100g` 539 / sugar 56.3 /
satFat 10.6, `source: "openfoodfacts+self-consistent"`, flags
`["nutrient:sugar","nutrient:saturated_fat","processing:ultra","nutriscore:e"]`.
Six spot-checked barcodes all match their real OFF values, no regressions.

**Out of scope, still open (Medium):** the `barcode_nutrition` cache is
first-write-wins, so the poisoned row (`source: cnf, calories: 182.00`) does not
self-heal — re-confirmed after the fix. The app scan path is unaffected
(`lookupBarcode` only writes that cache), but `server/routes/public-api.ts`
serves the stale row. Prod remediation is human-only per the codified doc.

## Implementation Notes

- Primary suspects: `server/services/barcode-lookup.ts` (`lookupBarcode`, `reconcilePer100g` — OFF-first fetch then CNF/USDA merge) and `server/services/nutrition-lookup.ts` (fallback order CNF → USDA → API Ninjas; name-search path). The OFF product-level extraction being correct while nutriments are wrong points at the reconcile/secondary-merge step, not the OFF fetch itself.
- Reproduce locally: `npm run server:dev` (NODE_ENV=development), login (demo/demo123), `curl -s localhost:3000/api/nutrition/barcode/3017620422003 -H "Authorization: Bearer <token>"` and inspect `per100g` + `servingInfo` + `isServingDataTrusted`. Log which source each field came from through the reconcile.
- Do NOT touch auth/JWT while investigating (health/auth is a no-delegate zone).
- Note: `isServingDataTrusted` was `false` for this barcode (serving defaulted to 100g) — check whether the serving/source confusion and the nutriment pollution share a root cause.
