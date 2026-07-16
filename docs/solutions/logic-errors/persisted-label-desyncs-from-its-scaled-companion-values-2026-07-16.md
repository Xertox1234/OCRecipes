---
title: A persisted serving-size label and its scaled nutrition values must derive from the same base — writing one from per-100g and the other from a real serving desyncs them
track: bug
category: logic-errors
tags: [nutrition, barcode, data-provenance, unit-conversion, caching]
module: server
applies_to: [server/services/**/*.ts]
symptoms: [A cache/DB row stores a human-readable serving-size label alongside macro values, but the macro values are computed from a DIFFERENT base (per-100g) than what the label implies (per-serving), A correction path reassigns the scale factor / grams variable but not the display label that was derived from the pre-correction raw value, leaving the label and the values it's paired with describing two different servings, No existing test asserts on the persisted write itself — only on the function's RETURNED result — so the mismatch ships invisibly even though the returned result is correct]
created: '2026-07-16'
severity: medium
---

# A persisted serving-size label and its scaled nutrition values must derive from the same base — writing one from per-100g and the other from a real serving desyncs them

## Problem

`server/services/barcode-lookup.ts`'s `lookupBarcode` writes a `barcodeNutrition` cache row (fire-and-forget, first-write-wins) that pairs a `servingSize` label with `calories`/`protein`/`carbs`/`fat` values. `docs/DATABASE.md` documents that table's `calories` column as "Calories per serving." Two related bugs, both found during review while wiring real USDA per-serving data into the USDA-by-UPC branch (P3-2026-07-16):

1. **per100g written next to a per-serving label.** The write used `per100g.calories?.toFixed(2)` etc. — per-**100g** values — while `servingSize` could be a real per-serving label (e.g. `"30g"`). For a 30g serving at 400 kcal/100g, this persisted `servingSize: "30g"` next to `calories: "400.00"` — a 3.33x overstatement of the true ~120 kcal/30g. This was previously dormant for the USDA-by-UPC branch specifically, because `rawServing` (the source of the label) was always `""` there before this todo, so the label always fell back to `${finalGrams}g` = `"100g"` — which happens to equal the per-100g denominator, masking the bug. The identical mismatch had existed in the OFF branch (which has always had a real `serving_size` label) for as long as the write code existed; it only stayed invisible whenever a product's calories happened to be small enough, or nobody looked at the row's coherence.
2. **A serving-size correction reassigns the scale but not the label.** `barcode-lookup.ts` has a plausibility-correction block: if a serving size implies an implausible calorie count or gram weight (e.g. a whole-package `"236g"` OFF `serving_size` on a K-cup box), it reassigns `servingGrams` to a category-based estimate (e.g. `15`) and sets `wasCorrected = true` — but it never reassigns `rawServing`, which still holds the pre-correction string (`"236g"`). The fix for bug 1 (deriving the write's macro values from `scaleNutrients(per100g, correctedScale)`) then paired the CORRECTED, small values (60 kcal for 15g) with the STALE, uncorrected label (`"236g"`) — understating calories ~15x relative to what the row's own label claims. This is *worse* than bug 1's original per-100g mismatch, and was only caught by tracing the correction branch specifically, not by the tests that already existed for it (they assert only on `result.perServing`/`result.servingInfo`, never on the write).

## Root Cause

Two independently-evolving pieces of a single logical unit — a display/storage label and the values it's paired with — were computed from different bases (`per100g` vs. a real serving; pre-correction `rawServing` vs. post-correction `servingGrams`) with no invariant enforcing they describe the same amount. Each individual line was locally correct (`per100g` genuinely is per-100g; `rawServing` genuinely is the original label), but nothing tied them together at the one place they're written as a pair. The bug only manifests when a REAL, non-default serving is involved (real per-serving USDA/OFF data, or a corrected estimate) — the default per-100g path (`finalGrams = 100`, `scale = 1`) makes `per100g === perServing` in numeric terms, so the mismatch is invisible until scale drifts from 1.

## Solution

Compute the values ONCE, scaled to the SAME thing the label describes, and reuse that single value everywhere the label is also used:

```typescript
const finalGrams = servingGrams || 100;
const scale = finalGrams / 100;
// Hoisted so the storage write and the returned result use the SAME
// per-serving values as `servingSize` — never derive them separately.
const perServing = scaleNutrients(per100g, scale);

storage.insertBarcodeNutritionIfAbsent({
  // `servingSize` must track `finalGrams` (what `perServing` was actually
  // scaled to), not a stale pre-correction raw value:
  servingSize: wasCorrected ? `${finalGrams}g` : rawServing || `${finalGrams}g`,
  calories: perServing.calories?.toFixed(2) ?? null,
  protein: perServing.protein?.toFixed(2) ?? null,
  carbs: perServing.carbs?.toFixed(2) ?? null,
  fat: perServing.fat?.toFixed(2) ?? null,
  // ...
});

return {
  per100g,
  perServing, // same object — not a second `scaleNutrients(per100g, scale)` call
  servingInfo: {
    displayLabel: wasCorrected ? `~${finalGrams}g (estimated)` : rawServing || `${finalGrams}g`,
    grams: finalGrams,
    // ...
  },
};
```

Note the storage `servingSize` deliberately omits the `~`/`"(estimated)"` cosmetic wrapper that the user-facing `servingInfo.displayLabel` keeps — a stored value that other code might `parseFloat()` should stay numeric-parseable; save the human-readable decoration for display-only fields.

## Prevention

- When a function returns/persists BOTH a label (grams, serving-size string, unit) and values scaled to it, compute the scaled values from a SINGLE variable that the label is also derived from — never let one side read `per100g`/raw-source and the other read a corrected/real-serving value independently.
- Any code path that reassigns the scale factor (a correction, an estimate, a unit conversion) must reassign EVERY downstream field derived from the pre-reassignment value in the same code path — grep for every other read of the original variable (`rawServing`, a raw grams value, a raw unit) before considering a correction block "done."
- A test suite that only asserts on a function's RETURNED result will miss this class of bug when the mismatch is in a side-effecting write (a cache row, an analytics event, a background job payload) that the function also produces. If a fire-and-forget write pairs a label with scaled values, add at least one test that asserts on the write's actual payload (mock the write, assert `toHaveBeenCalledWith(expect.objectContaining({...}))`) — not just on what the function returns to its caller.
- This is easy to miss precisely because the DEFAULT case (no real serving data, no correction) makes both sides numerically equal (scale = 1), so routine review and "does the returned JSON look right" spot-checks never exercise the divergence — it only appears once a non-default scale enters the picture, which may be exactly the enhancement/fix being reviewed (as it was here).

## Related Files

- `server/services/barcode-lookup.ts` — `lookupBarcode`'s `perServing` hoist and the `insertBarcodeNutritionIfAbsent` call (the fix)
- `server/services/__tests__/nutrition-lookup.test.ts` — the two regression tests asserting on the mocked write's payload (`mockInsertValues`), one for the real-serving-size happy path, one for the `wasCorrected` path
- `docs/DATABASE.md` — documents `barcodeNutrition.calories` as "Calories per serving," the contract this bug violated

## See Also

- [A data-trust/label flag derived from secondary-source agreement instead of the provenance signal it's meant to represent](trust-flag-conflated-with-secondary-source-agreement-2026-07-16.md) — a sibling lesson: a flag/label must be derived from the SAME data as what it describes, not a parallel computation that merely tends to correlate with it
- [An incomplete mock of a fire-and-forget dependency passes silently because the production code's own .catch() swallows the mock's TypeError](../code-quality/incomplete-mock-swallowed-by-fire-and-forget-catch-2026-07-16.md) — the reason this bug's own write path had zero test coverage before this todo
