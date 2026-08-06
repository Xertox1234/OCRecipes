---
title: "A confidence score that counts inferences gates itself — count evidence, not conclusions"
track: bug
category: logic-errors
tags: [confidence, inference, ocr, nutrition, gating, metrics, self-fulfilling]
module: client
applies_to: ["client/lib/nutrition-ocr-parser.ts", "client/screens/LabelAnalysisScreen.tsx", "client/lib/**/*.ts"]
symptoms: ["Adding a recovery rule raises a confidence score, which then clears a gate that recovery was supposed to be judged by", "A quality metric rises without any improvement in input quality", "Inferred values are displayed with nothing distinguishing them from measured ones", "The threshold that was tuned against direct readings now admits derived ones"]
severity: medium
created: 2026-08-05
last_updated: 2026-08-06
---

# A confidence score that counts inferences gates itself — count evidence, not conclusions

## Problem

`parseNutritionFromOCR` reports `confidence = extracted / TOTAL_FIELDS`, and
`LabelAnalysisScreen` shows an instant local preview only at `>= 0.6`.

A change added a rule that recovers fields the parser previously declined,
resolving an ambiguous glued unit by reasoning about *other values on the same
panel*. Those recoveries incremented `extracted` alongside directly-read fields,
so one device capture moved 0.6 → 0.8.

Nothing about that label was read any better. The score rose because the parser
made more inferences — and that same score decides whether the user is shown the
inferred numbers at all, with no visual distinction from measured ones. The gate
was tuned against direct readings and now admits derived ones.

## Symptoms

- A confidence/quality number improves in a diff that changed no input handling
- The threshold's meaning drifts silently: same number, weaker evidence behind it
- Reconciliation downstream doesn't cover the newly-populated fields, so a wrong
  inference can survive a later correction pass
- The change reads as a straight win in the diff, because more fields populate

## Root Cause

A metric that both (a) summarises how good the input was and (b) gates whether
derived output is shown cannot count the derivations. Doing so makes the gate
self-fulfilling: inference lifts the score, the score authorises showing the
inference.

Populating a field and vouching for a field are separate outcomes, and one
counter was being used for both.

## Solution

Adopt the inferred value, but do not let it count toward the score:

```ts
for (const { key, value, raw } of glued) {
  if (!gluedUnitIsForced(key, value, raw, result, substitutedUnit)) continue;
  result[key] = value;   // populated
  // deliberately no `extracted++` — confidence means "how much did we READ"
}
```

The affected capture keeps both recovered fields and returns to 0.6 — on the
threshold rather than over it. Assert both halves in one test so the
independence is explicit: the confidence value *and* the recovered fields.

If the distinction matters downstream, carry it rather than discarding it — a
separate count of inferred fields is more useful than one blended number, and it
gives a reconciliation step something to prioritise.

## Prevention

- State what a confidence number is measuring, in words, before changing what
  feeds it. "How much of the input did we read" and "how many fields do we have"
  are different metrics that happen to agree until inference is added.
- If a metric gates a decision, nothing derived *from* that decision's subject
  may feed the metric. Check for the loop explicitly.
- A quality score rising in a diff that did not improve input handling is a
  smell, not a result.
- Check what reconciles the newly-populated fields. Here `shouldReplaceWithAI`
  compares only calories/fat/protein/carbs/sodium, so an inferred
  `saturatedFat` or `dietaryFiber` was never re-checked by the AI pass. The
  sibling gap — `buildLabelConflict`'s `cmp` list also never compared
  `saturatedFat` against the database — was raised as a todo the same day this
  solution was written and is now **fixed**: `saturatedFat` is in `cmp`.
  Worth noting how, because "add it to the list" was not sufficient. The
  argument for leaving it out was that the server cannot condition on OCR
  provenance once the payload arrives — a direct read, an inference and a plain
  digit misread are indistinguishable — but that is a reason to trust the
  reading LESS, which argues for corroborating it, not for skipping the check.
  The real obstacle was quantitative: label readings are per-serving and get
  scaled to per-100, which scales their printing-rounding error too, so a naive
  comparison fires spurious conflicts. The fix is a floor traceable to the
  labelling rules (one 0.5 g printed step × the scaling factor), plus keeping
  the field out of the `compared >= 2` trust gate because a check run at a
  widened tolerance is weaker evidence than the others. `shouldReplaceWithAI`
  itself remains unaddressed — out of scope for that todo.

## Related Files

- `client/lib/nutrition-ocr-parser.ts` — the deferred adoption pass and its `extracted` comment
- `client/screens/LabelAnalysisScreen.tsx` — the `>= 0.6` instant-preview gate
- `client/screens/label-analysis-utils.ts` — `shouldReplaceWithAI`, the fields the AI pass reconciles
- `client/lib/__tests__/nutrition-ocr-parser.test.ts` — the confidence assertion plus its populated-fields counterpart
- `server/services/label-override.ts` — `cmp`, which now corroborates `saturatedFat` behind a label-rounding floor (see above)

## See Also

- [a derived bound is only as trustworthy as its derivation](derived-bound-is-only-as-trustworthy-as-its-derivation-2026-08-05.md) — the rule whose recoveries this stops counting
- [confidence-based follow-up refinement](../design-patterns/confidence-based-follow-up-refinement-2026-05-13.md) — the pattern this metric serves
- [absent field beats a defaulted one in a precedence chain](absent-field-beats-defaulted-one-in-a-precedence-chain-2026-07-31.md) — the same preference for admitting uncertainty over papering over it
