---
title: "Barcode lookup returns wrong per-100g nutriments for some products (source pollution)"
status: backlog
priority: medium
created: 2026-07-22
updated: 2026-07-22
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

- [ ] Identify WHERE the wrong nutriments for `3017620422003` originate: is OFF (identity/barcode match) returning them, or is a secondary source (CNF/USDA/API-Ninjas name-search) replacing/merging over OFF's self-consistent label data in `reconcilePer100g`?
- [ ] Characterize the blast radius: is this one bad barcode, or a systematic reconcile/fallback issue? (Spot-check ~10 well-known barcodes: server per-100g vs the product's real label.)
- [ ] Ensure an identity-matched (barcode) label source with self-consistent macros is NOT overwritten by a name/similarity-matched secondary source (apply/extend the codified `name-matched-secondary-must-not-replace-self-consistent-label` rule).
- [ ] Add a regression test pinning `3017620422003` (or a representative fixture) to Nutella's real macro ballpark, or asserting the reconcile prefers the identity-matched label.
- [ ] Confirm PR #694's FSA nutrient flags then fire correctly for the fixed data (high-sugar Nutella → `nutrient:sugar`).

## Implementation Notes

- Primary suspects: `server/services/barcode-lookup.ts` (`lookupBarcode`, `reconcilePer100g` — OFF-first fetch then CNF/USDA merge) and `server/services/nutrition-lookup.ts` (fallback order CNF → USDA → API Ninjas; name-search path). The OFF product-level extraction being correct while nutriments are wrong points at the reconcile/secondary-merge step, not the OFF fetch itself.
- Reproduce locally: `npm run server:dev` (NODE_ENV=development), login (demo/demo123), `curl -s localhost:3000/api/nutrition/barcode/3017620422003 -H "Authorization: Bearer <token>"` and inspect `per100g` + `servingInfo` + `isServingDataTrusted`. Log which source each field came from through the reconcile.
- Do NOT touch auth/JWT while investigating (health/auth is a no-delegate zone).
- Note: `isServingDataTrusted` was `false` for this barcode (serving defaulted to 100g) — check whether the serving/source confusion and the nutriment pollution share a root cause.
