---
title: "normalizeToPerHundredGrams fabricates a 100 g basis for an unparseable secondary serving"
status: done
priority: low
created: 2026-07-30
updated: 2026-08-10
assignee:
labels: [deferred, api]
github_issue:
---

# normalizeToPerHundredGrams fabricates a 100 g basis for an unparseable secondary serving

## Summary

`server/services/barcode-lookup.ts:219` normalizes a cross-validation secondary to
per-100 g with `const grams = parseFloat(data.servingSize) || 100`. A `servingSize`
that does not begin with a number silently normalizes at factor 1 — the values are
then treated as per-100 g when they are per-something-else, and that mis-scaled
secondary feeds the agree/disagree reconciliation that can **replace** the primary.

**Latent, not live.** Filed during PR #740 (the client-side sibling of this bug).

## Background

Every current producer emits a parseable string, which is why this has never fired:

| Producer                                | `servingSize`                   | `parseFloat` |
| --------------------------------------- | ------------------------------- | ------------ |
| `lookupCNF` (`nutrition-lookup.ts:541`) | hardcoded `"100g"`              | 100          |
| USDA (`nutrition-lookup.ts:582`)        | hardcoded `"100g"`              | 100          |
| API Ninjas (`nutrition-lookup.ts:282`)  | `` `${item.serving_size_g}g` `` | the number   |

The hazard is that the fallback is **silent**: a future producer (or a schema change
that lets a label-derived `"1 serving"` — see `nutrition-lookup.ts:856` — reach this
path) mis-normalizes with no signal. `|| 100` also swallows a legitimate `0`.

This is the same defect shape as PR #740, which removed the client-side
`servingInfo.grams ?? 100`. The distinction that kept the server out of #740's scope:
the _display_ path at `barcode-lookup.ts:723` pairs its `|| 100` with
`isServingDataTrusted: hasServingData && !wasCorrected`, so the client derives
`isPer100g === true` and the "Values shown per 100g" banner discloses it. **That one is
correct — do not touch it.** Only `:219` fabricates without disclosure.

## Acceptance Criteria

- [x] An unparseable or non-positive `servingSize` no longer normalizes at a fabricated
      factor of 1
- [x] A secondary that cannot be normalized is **discarded** rather than fed to
      `reconcileWithSecondary` — a source we cannot place on a known basis must not be
      able to override the primary
- [x] The discard is logged at `warn` with the barcode and the offending `servingSize`,
      so a future producer regression is visible rather than silent
- [x] A test covers each current producer's shape (`"100g"`, `` `${n}g` ``) proving they
      are byte-identical to today
- [x] A test covers an unparseable secondary (`"1 serving"`) proving it is discarded and
      the primary survives unchanged
- [x] `barcode-lookup.ts:723` (`finalGrams`) is **unchanged**

## Implementation Notes

- Change `normalizeToPerHundredGrams` to return `BarcodePer100g | null`, returning null
  when `parseFloat(data.servingSize)` is not a finite positive number.
- Three call sites, all in `barcode-lookup.ts` — `:596` (CNF), `:622` (USDA/API Ninjas),
  `:668` (USDA-by-UPC). The first two assign `secondaryPer100g`; guard each so a null
  leaves it unset and the search continues to the next source. `:668` assigns the
  **primary** `per100g` from `usdaByUPC.product` — a null there must fall through to
  whatever the existing no-primary path does, not proceed with a fabricated basis.
- Consider reusing `parseServingGrams` (`barcode-lookup.ts:180`), which already handles
  `"1 cup (240g)"`-style strings, instead of bare `parseFloat` — but only if it does not
  change the result for the three producers above. Pin that with the regression test
  before switching.

## Scope Contract

- **Mechanisms to use:** a nullable return on the existing helper — no new abstraction,
  no new service, no schema change
- **Files in scope:** `server/services/barcode-lookup.ts`,
  `server/services/__tests__/barcode-lookup*.test.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None. PR #740 is the client-side sibling and is independent.

## Risks

- `:668` sets the **primary**, not a secondary — the discard path there is a genuine
  behaviour change (a USDA-by-UPC hit that currently yields values would yield none).
  Confirm the downstream no-primary path is sound before changing that call site; it may
  be correct to scope the fix to the two secondary call sites only.
- The reconciliation logic (`reconcileWithSecondary`) has documented
  inversion-symmetry properties. Dropping a secondary must not change the `source`
  labelling contract (`"+verified"` / `"+self-consistent"`) for cases where a secondary
  was legitimately absent versus discarded.

## Updates

### 2026-07-30

- Filed while fixing the client-side sibling (PR #740). Verified latent against all
  three current producers — no live wrong-number path today.

### 2026-08-10 — RESOLVED

Fixed by swapping the parser, not by adding a guard around `parseFloat`.

**The filed severity was understated.** This todo described the failure as
"normalizes at factor 1". Measured against the committed code, the dangerous case is
the one `|| 100` never reaches — a numeric prefix with a non-mass unit:

| `servingSize`    | old result         | correct          |
| ---------------- | ------------------ | ---------------- |
| `"1 serving"`    | calories **25000** | reject           |
| `"2 cups"`       | calories **12500** | reject           |
| `"1 cup (240g)"` | calories **25000** | calories **104** |

`parseFloat("1 serving")` is `1`, not `NaN`, so the fallback never fired and the
factor became 100 — a 100× inflation, and 240× for the compound string.

**Resolution:** `normalizeToPerHundredGrams` now returns `BarcodePer100g | null` and
parses with the existing `parseServingGrams` (`:180`), which requires a `g`/`ml` unit
and so rejects all of the above while correctly reading 240 out of `"1 cup (240g)"`.
Guard is `grams === null || !(grams > 0)` — the `!(x > 0)` form also rejects NaN and
the legitimate-zero case the old `||` swallowed.

Call sites: the two secondaries discard and `log.warn` (CNF continues to the next
search term; USDA/API-Ninjas leaves both `secondaryPer100g` and `secondarySource`
unset so `reconcilePer100g` sees exactly the "no secondary" state). The `:668`
primary — the open judgment call — degrades to an empty per-100g set rather than
throwing: `mapUsdaFoodToNutrition` hardcodes `servingSize: "100g"` so null is
unreachable there today, and unlike the `INVARIANT VIOLATION` guard directly above it
this is bad upstream data, not a broken code contract, so it must not crash a live
lookup.

**Verification:** 9 new tests in
`server/services/__tests__/barcode-lookup-normalization.test.ts`; 252 tests green
across the four barcode suites plus five downstream consumers. Two-sided mutation
check: reverting the parser to `parseFloat(...) || 100` turns 7 tests RED while the 2
producer-characterisation tests stay GREEN. The integration test fails under the
mutation with `expected 7 to be undefined` — proving the discarded secondary really
would have gap-filled the primary's fiber.

**RETRACTED 2026-08-10 — the claim below was wrong.** `coerceNumber`'s string→`0` is
deliberate, not an oversight: the comment at `nutrition-lookup.ts:38` records that API
Ninjas' free tier returns gated fields as `"Only available for premium subscribers."`,
and `0` is the sentinel for "incomplete" that `:733`/`:758`/`:794` gate on. Nothing to
fix. What IS true: on a free key `serving_size_g` is gated → `"0g"`, which this todo's
fix now discards where it previously normalized at factor 1 — correct, but it reduces
API Ninjas secondary coverage. Original text kept below for the record:

**Surfaced, not fixed (out of scope contract):** `coerceNumber`
(`server/services/nutrition-lookup.ts:40-42`) maps a non-numeric **string** to `0`
rather than failing the parse, so an API Ninjas `serving_size_g` arriving as a JSON
string becomes `"0g"`. `barcode-lookup` now rejects that safely, but the coercion
itself weakens this todo's "purely latent" premise and lives in a file this todo's
Scope Contract excludes.
