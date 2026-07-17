<!-- Filename: P3-2026-07-17-off-self-consistency-gate-refinements.md -->

---

title: "Refine the OFF self-consistency gate: provenance source label + low-calorie tolerance band"
status: backlog
priority: low
created: 2026-07-17
updated: 2026-07-17
assignee:
labels: [deferred, nutrition, server]
github_issue:

---

# Refine the OFF self-consistency gate: provenance source label + low-calorie tolerance band

## Summary

Two LOW findings from the ai-reviewer pass on PR #654's `offSelfConsistent` gate
(`server/services/barcode-lookup.ts`), both fail-safe, deferred as refinements.

## Background

PR #654 stops a name-matched CNF/USDA secondary from REPLACING Open Food Facts
per-100g calories when OFF's own per-serving, per-100g, and serving-size fields
corroborate each other (≤15% relative deviation). Two edges were consciously
deferred:

1. **Provenance label ambiguity.** `source: "openfoodfacts"` is now emitted for
   two materially different confidence states: "no secondary was ever found" and
   "self-consistent OFF outright rejected a disagreeing secondary." The public
   Verified Product API (`server/routes/public-api.ts` `serializeFreeResponse`)
   exposes this string verbatim to paying customers as their sole provenance
   signal. A distinct marker (e.g. `openfoodfacts+self-consistent`) would encode
   the stronger corroboration — but any change to `source` strings must first
   audit every consumer that string-matches it (the `isServingDataTrusted`
   trust-flag bug of 2026-07-16 came from exactly such a `source.includes()`
   check — see docs/solutions/logic-errors/trust-flag-conflated-with-secondary-source-agreement-2026-07-16.md).

2. **15% relative tolerance false-negatives below ~33 kcal/serving.** FDA/Codex
   label rounding (nearest 5 kcal) can exceed 15% relative error on low-calorie
   small-serving products (spices, condiments), so genuinely correct labels in
   that band fail the gate and stay exposed to the original name-match
   replacement bug. An absolute floor (e.g. `Math.max(0.15 * perServing, 5)`)
   would cover it, at the cost of shielding some genuinely-inconsistent sub-10
   kcal entries (negligible absolute error either way). Needs a low-cal fixture
   test either way.

## Acceptance Criteria

- [ ] Decide on and implement (or explicitly reject) a distinct `source` marker
      for the self-consistent-rejected-secondary case, after auditing all
      `source` consumers (client `useNutritionLookup`, `public-api.ts`,
      `barcode_nutrition.source` column readers)
- [ ] Add an absolute-error floor to the self-consistency tolerance OR document
      why the low-cal band stays on the old behavior; fixture test for a
      ~20 kcal/serving product in either case
- [ ] Re-run the prod cache sweep (railway psql on `barcode_nutrition`, compare
      non-OFF-sourced rows against OFF's public API) after PR #656 ships, and
      check whether the `energy-kcal_100g: 0` + per-serving-ABSENT pattern
      (unshielded by design in #656 — only explicit 0-and-0 is corroboration)
      accounts for further phantom-calorie rows (ai-reviewer suggestion, PR #656);
      then DELETE/re-seed the rows the sweep flags — the cache is
      first-write-wins (`insertBarcodeNutritionIfAbsent`), so poisoned rows
      never self-heal after the fix deploys (code-review finding, PR #656)
- [ ] Consolidate the gate's numeric-agreement logic onto `valuesMatch` in
      `server/lib/verification-consensus.ts` (add a `tolerance` param defaulting
      to its current 0.05; pass 0.15 here) so the codebase keeps ONE agreement
      policy for nutrition data — its `a === b` short-circuit subsumes the
      explicit 0-and-0 branch and its <2 absolute floor covers most of the
      low-cal-band criterion above. CAVEAT: that floor would also match 0 vs
      1 kcal, which the gate deliberately leaves unshielded (zero-vs-tiny is
      contradiction, not agreement) — keep the nonzero-per-serving passthrough
      explicit when adopting it (code-review finding, PR #656)

## Implementation Notes

- Gate lives in `server/services/barcode-lookup.ts` (search `offSelfConsistent`)
- Tests: `server/services/__tests__/barcode-lookup.test.ts` — the McSweeney's
  describe block from PR #654 is the pattern to extend

## Scope Contract

- **Mechanisms to use:** the existing `offSelfConsistent` computation and `source` string plumbing — nothing new
- **Files in scope:** `server/services/barcode-lookup.ts`, `server/services/__tests__/barcode-lookup.test.ts`, `server/routes/public-api.ts` (audit only), `client/hooks/useNutritionLookup.ts` (audit only)
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- PR #654 merged

## Risks

- `source`-string consumers that substring-match ("verified") — audit before renaming anything

## Updates

### 2026-07-17

- Filed from ai-reviewer LOW findings during PR #654 review
- Added from PR #656 code review: delete/re-seed step on the sweep criterion
  (first-write-wins cache) and the `valuesMatch` consolidation criterion; the
  gate itself gained macro/kJ contradiction guards and grams-free zero
  corroboration in #656 directly
