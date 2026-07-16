---
title: A data-trust/label flag derived from secondary-source agreement instead of the provenance signal it's meant to represent
track: bug
category: logic-errors
tags: [nutrition, barcode, data-provenance, cross-validation, api]
module: server
applies_to: [server/services/**/*.ts]
symptoms: [A boolean flag named for one condition ("do we have real per-serving data") is actually computed from an unrelated condition ("did a secondary source cross-validate the value"), Correct correctly-scaled data gets mislabeled as untrustworthy/fallback whenever the unrelated secondary signal happens not to fire, The two signals usually agree often enough in manual testing that the bug hides — it only surfaces when the orthogonal condition (cross-validation) fails independently of the condition the flag claims to track]
created: '2026-07-16'
severity: medium
---

# A data-trust/label flag derived from secondary-source agreement instead of the provenance signal it's meant to represent

## Problem

`server/services/barcode-lookup.ts`'s `isServingDataTrusted` was derived as `!wasCorrected && source.includes("verified")`. `source` only gains a `"+verified"` suffix when `reconcilePer100g` finds a secondary source (CNF/USDA) whose calorie count agrees with the primary (OFF) within a `[0.5, 2.0]` ratio — a check about **whether an unrelated per-100g value happened to cross-validate**, not about **whether a real serving size existed and was used to scale the displayed value**. For a barcode with a genuine "355 ml" serving size, correctly scaled to ~82 kcal, the flag came out `false` whenever CNF/USDA had no match or disagreed — mislabeling correct, trustworthy data as "(per 100g)" with a "check package" disclaimer.

## Root Cause

The flag's name and every consumer's mental model ("do we have real per-serving data to show, or only per-100g?") described one condition. Its actual derivation measured a second, independent condition (secondary-source calorie agreement) that happens to correlate with the first often enough that ad hoc testing didn't catch the mismatch. `git log -S` on the line confirmed this was the design from the feature's original commit, not later drift introduced by a refactor — the two concerns were coupled from the start and never separated.

This is a general trap, not specific to nutrition data: any boolean whose docstring/name says "is X true" but whose implementation actually checks "did Y happen" — where X and Y are merely correlated, not equivalent — will silently mislabel the minority of cases where X and Y disagree.

## Solution

Derive the flag from the SAME data the displayed value was actually computed from, not from a parallel/secondary computation:

```typescript
// Capture BEFORE any correction/estimation logic can reassign the variable —
// the "did we have real data" question must be asked about the ORIGINAL input,
// not the (possibly-corrected) working value.
const hasServingData = servingGrams !== null && servingGrams > 0;
// ... existing correction logic may reassign `servingGrams` and set `wasCorrected` ...

isServingDataTrusted: hasServingData && !wasCorrected,
// NOT: !wasCorrected && source.includes("verified")  — `source` reflects an
// unrelated cross-validation outcome, not serving-data provenance.
```

The `> 0` guard matters whenever a falsy-but-not-null value (`0`) is semantically "no real data" downstream — a pathological `"0 ml"` parse must not read as trusted.

## Prevention

- When a flag's name asserts a condition ("is trusted", "is verified", "has real data"), grep every place its value is SET and confirm each one actually measures that exact condition — not a value that merely tends to correlate with it.
- If two independent computations (e.g. cross-validation success, and serving-data presence) both existed before this bug and only one was reflected in the flag, prefer keeping them as separate fields/flags rather than folding one into an "is-trusted" catch-all — the todo's `docs/solutions/conventions/indicate-data-source-to-users-2026-05-13.md` documents the presence-based convention this codebase already committed to for the "no client production change was needed" outcome that resulted here.
- A regression test suite for this class of bug needs a fixture where the two conditions DISAGREE (real serving data present, cross-validation fails) — a suite that only exercises cases where both conditions happen to agree will pass against either the correct or the buggy derivation.

## Related Files

- `server/services/barcode-lookup.ts` — `isServingDataTrusted` derivation (the fix)
- `server/services/__tests__/barcode-lookup.test.ts` — regression tests, including the disagreement fixture (real serving size + failed cross-validation)
- `client/lib/serving-size-utils.ts` — the already-correct sibling implementation (presence-based, no cross-validation coupling) that this fix now matches

## See Also

- [Indicate data source / format to users when falling back](../conventions/indicate-data-source-to-users-2026-05-13.md)
