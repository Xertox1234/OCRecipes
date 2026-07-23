---
title: "Partially correcting a uniformly-wrong record must blank the un-corrected fields, not inherit them"
track: bug
category: logic-errors
tags: [data-integrity, nutrition, override, cross-field-invariant, fail-safe, trust-the-source]
module: server
applies_to: ["server/services/label-override.ts"]
symptoms: ["a 'corrected' record shows an impossible cross-field relationship (sugar > total carbs, saturated fat > total fat)", "the override fixes the fields you compared but nonsense appears in fields you didn't", "the impossibility only shows on real data, never in test fixtures that omit the sibling fields"]
created: 2026-07-22
severity: high
---

# Partially correcting a uniformly-wrong record must blank the un-corrected fields, not inherit them

## Problem

The Smart Scan "trust the label" feature overrides a wrong Open Food Facts barcode entry with a scanned nutrition label. The first merge kept the DB result and overlaid only the fields the label read:

```ts
const mergedPer100g = { ...dbResult.per100g, ...per100 }; // WRONG
```

`per100` held only `calories/sugar/fat/saturatedFat` (what the label compared). Everything else — `carbs`, `protein`, `fiber`, `sodium` — stayed at the DB's value. But the whole reason this code runs is that the DB entry is **materially wrong**: Cherry Coke's OFF record has per-100 ml values in the per-serving fields, so *every* macro is mis-scaled ~3.55× low. After the override, the flagship result showed **sugar 39 g > total carbs ~11 g** — nutritionally impossible (sugars ⊆ carbohydrates), on a result the UI presents as trustworthy.

## Symptoms

- The corrected result displays a cross-field impossibility: `sugar > carbs`, `saturatedFat > fat`, `fiber > carbs`.
- The fields you explicitly corrected look right; the ones you didn't are quietly wrong.
- Reproducible on real upstream data but **invisible in unit tests** whose fixtures omit the sibling fields (the Cherry Coke fixture had no `carbs`, so no test caught it until one was added that sets `carbs`).

## Root Cause

Spreading the DB record as the base (`{ ...dbResult, ...corrections }`) inherits every field you didn't override. That is safe only when the un-corrected fields are independently trustworthy. When the record was detected as **uniformly** wrong (one systemic error contaminates the whole entry), no field is trustworthy — so inheriting any of them re-introduces the very error the override exists to fix, and mixing corrected + uncorrected fields breaks invariants that hold *within* a single real record.

A tempting half-fix — "carry more of the parsed fields through so carbs gets corrected too" — does **not** work: the input (OCR) frequently doesn't capture every field. The flagship label string itself (`"Per 355 mL / Calories 150 / Sugars 39 g"`) has no carbs line, so carbs would still be inherited from the DB and still exceed sugar.

## Solution

Build the corrected block from **only** what the trusted source actually provided; leave everything else `undefined` (blank), not inherited and not `0`:

```ts
// The corrected macro block = EXACTLY what the label read. This entry is
// uniformly wrong, so its other macros can't be trusted; blank them rather than
// inherit. Keep only orthogonal enrichment that doesn't participate in a
// cross-field sub-relationship (here: caffeine + NOVA/Nutri-Score/category tags).
const mergedPer100g: BarcodePer100g = {
  ...per100,                              // only the label-read fields
  caffeine: dbResult.per100g.caffeine,    // orthogonal; category-derived flag survives
};
```

Blank to `undefined`, not `0`: `0 g` is a false claim ("this product has no carbs"), whereas `undefined` is the honest "not read" and renders as "—". Verify downstream consumers tolerate `undefined` (scaling helpers must map `undefined → undefined`, displays must render a dash, not `NaN`).

Load-bearing fields survive automatically if they're always part of the correction: here `sugar` is always read on a conflict (it's a compared field), so the recomputed "High in Sugar" flag still fires.

## Prevention

- When overriding a subset of a record you've judged untrustworthy, the corrected result must contain **only** corrected fields + orthogonal enrichment — never silently inherit sibling fields.
- Add a test that sets a sibling field (e.g. `carbs`) on the wrong-record fixture and asserts the corrected result does **not** produce the impossible relationship — assert the numeric invariant (`!(sugar > carbs)`), not just "field is undefined", so a future default-to-0 regression is also caught.
- Test the **partial-input** case (only some fields read), not just the full-input case — teaching-to-the-test with a complete fixture hides exactly this bug.

## Related Files

- `server/services/label-override.ts` — `buildLabelConflict`, the `mergedPer100g` construction.
- `server/services/__tests__/label-override.test.ts` — the "blanks un-read DB macros" + partial-label invariant tests.

## See Also

- [name-matched-secondary-must-not-replace-self-consistent-label](name-matched-secondary-must-not-replace-self-consistent-label-2026-07-17.md) — the source-selection sibling: don't replace identity-matched self-consistent data with a name-matched secondary. This rule is the other half: once you *have* decided to override, don't inherit the sibling fields.
- [../design-patterns/cross-check-derived-factor-against-trusted-anchor-2026-07-22.md](../design-patterns/cross-check-derived-factor-against-trusted-anchor-2026-07-22.md) — the guard that decides *whether* to override at all.
