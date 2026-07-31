---
title: "normalizeToPerHundredGrams fabricates a 100 g basis for an unparseable secondary serving"
status: backlog
priority: low
created: 2026-07-30
updated: 2026-07-30
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

- [ ] An unparseable or non-positive `servingSize` no longer normalizes at a fabricated
      factor of 1
- [ ] A secondary that cannot be normalized is **discarded** rather than fed to
      `reconcileWithSecondary` — a source we cannot place on a known basis must not be
      able to override the primary
- [ ] The discard is logged at `warn` with the barcode and the offending `servingSize`,
      so a future producer regression is visible rather than silent
- [ ] A test covers each current producer's shape (`"100g"`, `` `${n}g` ``) proving they
      are byte-identical to today
- [ ] A test covers an unparseable secondary (`"1 serving"`) proving it is discarded and
      the primary survives unchanged
- [ ] `barcode-lookup.ts:723` (`finalGrams`) is **unchanged**

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
