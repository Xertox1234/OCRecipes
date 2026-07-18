<!-- Filename: P3-2026-07-17-off-self-consistency-gate-refinements.md -->

---

title: "Refine the OFF self-consistency gate: provenance source label + low-calorie tolerance band"
status: done
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

- [x] Decide on and implement (or explicitly reject) a distinct `source` marker
      for the self-consistent-rejected-secondary case, after auditing all
      `source` consumers (client `useNutritionLookup`, `public-api.ts`,
      `barcode_nutrition.source` column readers)
- [x] Add an absolute-error floor to the self-consistency tolerance OR document
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
      — **DEFERRED, see Updates: not executed by this run, human action needed.**
- [x] Consolidate the gate's numeric-agreement logic onto `valuesMatch` in
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

- **Mechanisms to use:** the existing `offSelfConsistent` computation, `source` string plumbing, and the existing `valuesMatch` numeric-agreement primitive — nothing new
- **Files in scope:** `server/services/barcode-lookup.ts`, `server/services/__tests__/barcode-lookup.test.ts`, `server/routes/public-api.ts` (audit only), `client/hooks/useNutritionLookup.ts` (audit only), `server/lib/verification-consensus.ts` (AC4's `tolerance` param — added below)
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
- Scope Contract reconciled at execution time: it predated AC3/AC4 (both
  appended above from the PR #656 review, after the Contract's original
  "Files in scope" list was written) and omitted `server/lib/verification-
consensus.ts`, which AC4 explicitly requires editing. Added it to the
  Contract's file list before implementing, per advisor guidance during the
  executor's Step 3.5 pre-check — this is reconciling a stale Contract
  against its own todo's ACs, not scope creep.
- **AC1 implemented**: `reconcilePer100g` in `server/services/barcode-lookup.ts`
  now emits `"<primaryLabel>+self-consistent"` (narrow reading: only when a
  secondary was found, both sides had positive calories, they disagreed, AND
  the disagreement was rejected specifically because the primary's own
  self-consistency check overrode `preferSecondaryOnDiscrepancy`). Consumer
  audit: `client/hooks/useNutritionLookup.ts` never reads the `source` field
  from the barcode response at all; `server/routes/public-api.ts`'s
  `serializeFreeResponse` forwards `row.source` verbatim with no
  matching/substring checks (`FreeProductResponse.source` is an unconstrained
  `z.string()`); `server/scripts/backfill-barcode-nutrition.ts` only WRITES
  `source`, never reads/matches it. No consumer does an exact or substring
  match on `"openfoodfacts"` anywhere. Safe to introduce. Updated 3 existing
  regression-test assertions in `barcode-lookup.test.ts` that hit this exact
  branch (the McSweeney's happy-path test, the "just under 15%" boundary
  test, and the kJ-only-derivation test) from `"openfoodfacts"` to
  `"openfoodfacts+self-consistent"`.
- **AC2 implemented**: a 5 kcal absolute floor, OR'd alongside the relative
  check, in the gate's final (already-guaranteed-nonzero) branch. Two new
  fixture tests added (~20 kcal/serving product): one where the floor rescues
  a label that fails the 15% relative check (diff=4 kcal, relative=20%), one
  confirming the floor does NOT over-widen (diff=6 kcal, relative=30%, still
  swaps to the secondary).
- **AC4 implemented**: `valuesMatch` in `server/lib/verification-consensus.ts`
  gained a `tolerance` param (default `0.05`, preserving every existing
  caller). The gate's final ratio-check branch now calls
  `valuesMatch(scaledPer100g, offPerServingCal, 0.15)`. The explicit
  `0 && 0` zero-corroboration branch (with its PR #656 macro-Atwater/kJ-
  contradiction guards) was deliberately left untouched and NOT routed
  through `valuesMatch` — `valuesMatch(0, 0)` short-circuits `true` via
  `a === b` and would silently drop those guards, reopening the phantom-
  calorie bug. **Behavior-preservation note**: `valuesMatch`'s relative
  branch divides by `max(|a|, |b|)`, not `offPerServingCal` (the label value)
  as the pre-existing gate code did. This shifted the exact 15%-tolerance
  boundary slightly (label-denominator threshold ≈269.6 → max-denominator
  threshold ≈263.5 for the McSweeney's fixture, a minor widening). The two
  pre-existing boundary-pinning tests were updated to pin the new boundary
  (264/263 replacing 270/267) rather than silently drift — caught by the
  test suite itself (the "just over" test failed before the fixture update).
  Added dedicated `tolerance`-param tests to
  `server/lib/__tests__/verification-consensus.test.ts`.
- **AC3 — DEFERRED, not executed by this run (needs a human decision).**
  Confirmed PR #656 is merged (2026-07-17T22:12:14Z) and deployed to prod
  (Railway restart 2026-07-17T22:13:56Z, same commit `df08f768`), so the
  sweep's own precondition is satisfied. Two things blocked autonomous
  execution: (1) the full sweep (compare non-`openfoodfacts`-sourced
  `barcode_nutrition` rows against live OFF data) needs either a new script
  file — which the Scope Contract's file list excludes — or ad hoc
  queries/network calls; (2) this session's `railway variables` and
  `railway run -- psql ...` calls were both explicitly BLOCKED by the
  environment's auto-mode permission classifier (reason: "Blocked by
  classifier"), independent of any choice made here — the environment itself
  declines to hand an autonomous agent production database credentials or a
  live connection, read-only or not. DELETE/re-seed against a monetized prod
  table is a human-judgment, human-executed action either way. For whoever
  picks this up:
  - Read-only sweep query (run via `railway connect Postgres` or an
    authenticated `psql $DATABASE_URL`, from a human session):
    ```sql
    SELECT count(*) AS total,
           count(*) FILTER (WHERE source NOT LIKE 'openfoodfacts%') AS non_off_sourced
    FROM barcode_nutrition;
    ```
    then pull the `non_off_sourced` rows (`SELECT barcode, product_name,
source, calories FROM barcode_nutrition WHERE source NOT LIKE
'openfoodfacts%';`) and, for each barcode, re-fetch
    `https://world.openfoodfacts.org/api/v0/product/<barcode>.json` and run
    it through the CURRENT (post-#654/#656/this-PR) `offSelfConsistent` +
    `reconcilePer100g` logic to see whether today's code would now keep OFF's
    value instead of the cached secondary — those are the poisoned,
    first-write-wins rows from the pre-#654 bug.
  - The `energy-kcal_100g: 0` + per-serving-ABSENT pattern is a subset of the
    same sweep: among the `non_off_sourced` rows, the ones where the re-
    fetched OFF record has `energy-kcal_100g === 0` but no
    `energy-kcal_serving`/`energy_serving` field at all (not present-and-0)
    are exactly this pattern — `offSelfConsistent` returns `false` on the
    initial `offPerServingCal === undefined` guard for these, so they fall
    through to the pre-existing replace-on-discrepancy behavior and can still
    carry phantom (non-OFF) calories today. This is unshielded BY DESIGN in
    #656 (only explicit 0-and-0 is corroboration; absent per-serving can't be
    corroborated) — this todo did not change that, per its Scope Contract.
  - Remediation once flagged barcodes are identified: `DELETE FROM
barcode_nutrition WHERE barcode IN (<flagged list>);` — the cache is
    first-write-wins (`insertBarcodeNutritionIfAbsent`), so the next scan of
    each barcode re-seeds it correctly under the now-fixed code. No re-seed
    script is needed beyond a normal rescan.
- Reviewed by `code-reviewer` + `ai-reviewer` + `server-reviewer` in parallel,
  1 round. No CRITICALs from any reviewer. One WARNING (server-reviewer,
  confirming the `valuesMatch` max-denominator boundary shift is self-
  disclosed in this Updates section, not silently absorbed — already true at
  the time it was raised). 8 SUGGESTIONs across the three reviewers, all
  trivial and applied inline: hoisted `ABSOLUTE_TOLERANCE_FLOOR_KCAL` to
  module scope (matching the file's existing constant-hoisting convention),
  reworded a comment that overstated `valuesMatch`'s small-value branch as
  literally unreachable rather than subsumed by the 5 kcal floor, tightened
  the two boundary-pinning test fixtures to 264/263 (bracketing the ≈263.5
  new boundary symmetrically, restoring a tight mutation-kill pin the
  270/263 pair had loosened on the low side), fixed two test comments whose
  hand-computed percentages used the pre-consolidation label-denominator
  math instead of `valuesMatch`'s max-denominator math, and strengthened
  `verification-consensus.ts`'s module-doc comment to note it's now a shared
  dependency of both `storage/` and `services/`. No round 2 needed — every
  post-dispatch change was comment/test-fixture/constant-hoist only, zero
  production-logic change beyond what the reviewers already saw.
