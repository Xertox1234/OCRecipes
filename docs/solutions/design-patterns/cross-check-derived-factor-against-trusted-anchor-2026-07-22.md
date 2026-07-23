---
title: "Cross-check an input-derived scaling factor against a trusted anchor before trusting the computed comparison"
track: knowledge
category: design-patterns
tags: [data-integrity, ocr, input-validation, fail-safe, nutrition, computed-comparison, normalization]
module: server
applies_to: ["server/services/label-override.ts"]
created: 2026-07-22
---

# Cross-check an input-derived scaling factor against a trusted anchor before trusting the computed comparison

## When this applies

You normalize an untrusted input to compare it against a reference, and the **normalization factor itself comes from another untrusted input field**. Example: a scanned nutrition label is per-serving; to compare it to a per-100 database entry you divide by the label's own OCR-parsed serving size (`factor = 100 / labelGrams`). If `labelGrams` is misread (OCR drops or inserts a digit: `80 → 800`, `355 → 3550`), every normalized value is silently wrong — garbage-in — even though the *nutrient* readings were parsed correctly.

## Smell patterns

- A comparison whose denominator is a value parsed from the same untrusted source as the thing being compared.
- "Trust the scanned input over the database" flows that never sanity-check the input's magnitude fields.
- A per-100 ↔ per-serving normalization where a wrong serving size deflates/inflates the whole vector.

## Why

A misread magnitude field doesn't fail loudly — it produces a plausible-looking but wrong comparison, which then drives a decision (fire/suppress a flag, accept/reject an override). Two failure directions: a too-small misread inflates per-100 and over-fires; a too-large misread deflates it and **suppresses a flag the baseline already gets right** — i.e. the feature makes the result *worse* than doing nothing.

The fix is to validate the factor against an **independent anchor that has already passed its own sanity gate** — here, the database's own serving size, but only when it is flagged trusted (`isServingDataTrusted`, meaning it cleared the DB pipeline's `MAX_PLAUSIBLE_SERVING_*` checks). For the same barcode the serving is a fixed property of the product, so a gross (>4×) disagreement between the label's parsed serving and the trusted DB serving means the label's *serving* was misread.

The key reframe (this is what makes it correct, not a contradiction of "trust the input"): on gross disagreement you **reject the computed comparison, not the input's readings**. You're declining to divide by a denominator you can't trust — the nutrient values the label read are never overridden by the database; you simply fall back to showing the database result (the fail-safe default) instead of asserting a mis-scaled correction.

## Examples

```ts
// factor's denominator (labelGrams) is OCR-parsed — untrusted.
const labelGrams = parseServingGrams(label.servingSize);
if (labelGrams == null || labelGrams <= 0 || labelGrams > MAX_PLAUSIBLE) return none; // absolute bound

// Cross-check against an INDEPENDENT, already-sanity-gated anchor.
const dbGrams = dbResult.servingInfo.grams;
if (dbResult.isServingDataTrusted && dbGrams > 0) {
  const ratio = labelGrams / dbGrams;
  if (ratio > 4 || ratio < 0.25) return none; // fail toward the trusted default
}

const factor = 100 / labelGrams; // now safe to normalize + compare
```

Layer it: an absolute plausibility bound (catches gross misreads when no anchor exists) **plus** the trusted-anchor ratio check (catches misreads inside the plausible range when an anchor does exist).

## Exceptions

- No trusted anchor available → the absolute bound is the only backstop; document the residual (a misread inside the plausible window is uncatchable without an independent signal — that's an input-reliability problem, not a comparison-logic one).
- Don't anchor against an **untrusted** reference — that just trades one garbage input for another and can false-reject a correct input when the reference is the wrong one.
- Pick the ratio threshold from what the two sources *should* agree on. For the same identity (same barcode) the property is fixed, so any large disagreement is a misread; a generous bound (4×) avoids false rejections on legitimate rounding/convention differences while still catching order-of-magnitude OCR errors.

## Related Files

- `server/services/label-override.ts` — `buildLabelConflict`, the `MAX_PLAUSIBLE_LABEL_SERVING_GRAMS` bound + the `isServingDataTrusted` ratio cross-check.
- `server/services/barcode-lookup.ts` — `MAX_PLAUSIBLE_SERVING_GRAMS/CALORIES` (the gate that makes a trusted DB serving a legitimate anchor).

## See Also

- [../logic-errors/partial-correction-must-blank-untrusted-sibling-fields-2026-07-22.md](../logic-errors/partial-correction-must-blank-untrusted-sibling-fields-2026-07-22.md) — the sibling rule for *after* you've decided to override: blank the fields the input didn't provide.
- [../logic-errors/name-matched-secondary-must-not-replace-self-consistent-label-2026-07-17.md](../logic-errors/name-matched-secondary-must-not-replace-self-consistent-label-2026-07-17.md) — a related source-trust decision in the same barcode pipeline.
