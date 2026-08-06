---
title: "A confidence score that counts inferences gates itself — count evidence, not conclusions"
track: bug
category: logic-errors
tags: [confidence, inference, ocr, nutrition, gating, metrics, self-fulfilling, containment, lookup-table]
module: client
applies_to: ["client/lib/nutrition-ocr-parser.ts", "client/screens/LabelAnalysisScreen.tsx", "client/lib/**/*.ts", "server/services/label-override.ts"]
symptoms: ["Adding a recovery rule raises a confidence score, which then clears a gate that recovery was supposed to be judged by", "A quality metric rises without any improvement in input quality", "Inferred values are displayed with nothing distinguishing them from measured ones", "The threshold that was tuned against direct readings now admits derived ones", "A comment or review rule enumerates several cases while the code beside it handles one, both written in the same commit", "A merged result displays a nutritionally impossible pair such as sugar exceeding carbohydrate or saturated fat exceeding total fat"]
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
  Worth noting how, because "add it to the list" was not sufficient, and the
  first attempt shipped two CRITICALs that are the real lesson here.

  The argument for leaving the field out was that the server cannot condition on
  OCR provenance once the payload arrives — a direct read, an inference and a
  plain digit misread are indistinguishable. Half of that is a reason to trust
  the reading LESS, which argues for corroborating it rather than skipping the
  check. **The other half was a true statement about the WIRE FORMAT that got
  filed as a fact about the world.** The payload was the team's own; it could
  carry provenance, and now does. When a check is blocked because "we can't tell
  X apart downstream", ask who owns the format that lost X — the answer is often
  you.

  Three things had to be true before the comparison was safe:

  1. **Provenance on the wire.** `directReads` lists the fields the parser read
     off a glyph run; the `saturatedFat` row is compared only when the field is
     positively listed. An inferred value is still accepted and still adopted —
     only its power to CONDEMN the record is gated. Critically the field is
     OPTIONAL and absence means "not a direct read": clients already installed
     send nothing, and defaulting them to "direct" would have left the entire
     installed base on the buggy path. (See
     [absent field beats a defaulted one](absent-field-beats-defaulted-one-in-a-precedence-chain-2026-07-31.md)
     — the same rule, reached independently a second time.)
  2. **A floor traceable to the labelling rules** (one 0.5 g printed step ×
     the per-serving→per-100 scaling factor), because scaling the reading scales
     its rounding error too. That floor must itself be **clamped**: `step ×
     factor` is unbounded and no minimum serving is enforced, so a 5 g serving
     produced a 10 g/100g floor — wider than either FSA saturated-fat band, i.e.
     a check that could no longer see a high-saturated-fat crossing. Bounded now
     at half the MEDIUM band width from `shared/constants/nutrition-bands.ts`.
  3. **A blanking scope.** This is the subtle one, and it generalises well
     beyond nutrition — see the rule below.

  `shouldReplaceWithAI` itself remains unaddressed — out of scope for that todo.

- **Adding a field to a detector changes what its CONSEQUENCE should be scoped
  to.** `buildLabelConflict` answers a conflict by discarding the record's
  un-read macros (carbs/protein/fibre/sodium). That was written when only
  calories/sugar/fat could raise a conflict, where a disagreement really does
  imply the record's whole per-100 basis is wrong. Admitting `saturatedFat`
  created a state the blanking logic was never written for: a conflict raised by
  one field while the other three AGREE — which is evidence *against* a
  basis-wide error, not for it. The unchanged code discarded three macros on the
  strength of a single disagreeing nutrient.

  The tell is that the consequence was **unconditional** while its justification
  was **field-specific**. When you widen the set of inputs that can trigger an
  action, re-read the action's rationale and ask which inputs it was actually
  argued for. Here the fix is to scope the blanking to conflicts that include a
  corroborating field, reusing the same per-row flag rather than adding a
  parallel list. A future reviewer of this shape should check it directly:
  *does every new member of the trigger set justify the full blast radius?*

- **Narrowing a destructive consequence re-exposes whatever it was suppressing.**
  The scoped blanking above immediately made a second defect reachable: retaining
  the record's `fat` beside a label-corrected `saturatedFat` can display
  `saturatedFat > fat` — nutritionally impossible, on the screen that tells the
  user to trust the label. The coarse "drop everything" version had been hiding
  it for free. So for any "blank less" / "keep more" change, enumerate the values
  now retained and ask whether each is in a **containment relationship**
  (`saturated`/`trans ≤ fat`, `sugars ≤ carbs`) with a value the other source
  just replaced. Mixed provenance across such a pair is the failure mode, and it
  is reachable precisely because the payload's field set is smaller than the
  record's — here the parser declines an ambiguous glued `Total Fat 19` while
  reading `Saturated Fat 6 g` on the next line perfectly.

- **A rule that names N cases needs a TABLE of N rows, not a conditional for the
  one that was reproduced first.** This is the sharpest lesson of the sequence,
  because it is the one that recurred *inside a single commit*. The bullet
  immediately above was written as the review rule for the fix — it names
  `saturated`/`trans ≤ fat` **and** `sugars ≤ carbs` — while the code shipped in
  that same commit guarded exactly one pair. `sugar > carbs` went out unguarded
  and reproduced on an ordinary near-limit record: DB `sugar: 24, carbs: 25`
  against a label whose sugars AGREE (8.7 g over 30 g is 29 per-100, inside the
  25% band, so it raises no conflict) while `saturatedFat` conflicts alone. The
  displayed block was `sugar 29 / carbs 25` per-100 and `8.7 / 7.5` per-serving,
  with `compared: true` — which opens one-tap logging and puts the impossible
  pair into a food log with no review step.

  Writing the principle and the instance in the same sitting does not keep them
  in step; if anything it hides the gap, because the prose reads as a summary of
  the code sitting next to it. **The structural fix is to make the enumeration
  the implementation** — a `CONTAINMENT_PAIRS` table the loop iterates — so
  "which pairs are guarded" has exactly one answer and a review can diff the
  rule's list against the code's list instead of reading prose and nodding.

  Three properties the table needs beyond simply existing, each of which was
  independently wrong here:

  1. **Evaluate the FINAL MERGED block, not pairwise against each source.** The
     pairwise form looked correct only because `carbs` never appears in the
     label payload — a coincidence of today's field set, not an invariant. The
     next field added to the payload breaks it silently.
  2. **No "one source supplied both sides, so it is self-consistent" carve-out.**
     That premise was false: `totalFat` and `saturatedFat` are independent
     per-line OCR captures, and one corrupts while the other reads perfectly. A
     `Total Fat 5g 6%` / `Saturated Fat 2g 9%` panel with the g→9 misread yields
     96.7 g of saturated fat inside 16.7 g of total fat at a 30 g serving, both
     label-sourced, so a provenance-gated guard never even looks.
  3. **Provenance decides which SIDE to drop, never whether to look.** And the
     "neither side came from the new source" case is a genuine third answer, not
     a fallthrough: that is the record contradicting itself, which this merge did
     not cause and which the non-merging path displays untouched — and dropping
     the child there would delete the *flag-bearing* side of the pair.

  Include a row only where the containment holds under **every** regime the data
  spans. `fibre ≤ carbs` looks like the obvious fourth row and is excluded: EU
  1169/2011 declares available carbohydrate with fibre outside it, US labels
  count fibre inside, OFF aggregates both, so a correct EU figure legitimately
  violates it. Prove each row is load-bearing by deleting it and confirming
  exactly one test fails.

## Related Files

- `client/lib/nutrition-ocr-parser.ts` — the deferred adoption pass and its `extracted` comment
- `client/screens/LabelAnalysisScreen.tsx` — the `>= 0.6` instant-preview gate
- `client/screens/label-analysis-utils.ts` — `shouldReplaceWithAI`, the fields the AI pass reconciles
- `client/lib/__tests__/nutrition-ocr-parser.test.ts` — the confidence assertion plus its populated-fields counterpart
- `server/services/label-override.ts` — `cmp` (the `requiresDirectRead` provenance gate, the clamped label-rounding floor) and `basisDisproven` (the blanking scope)
- `server/services/__tests__/label-override-provenance-integration.test.ts` — the parser→payload→server seam: one panel, one glyph different, same parsed value; inferred is not compared, direct is

## See Also

- [a derived bound is only as trustworthy as its derivation](derived-bound-is-only-as-trustworthy-as-its-derivation-2026-08-05.md) — the rule whose recoveries this stops counting
- [confidence-based follow-up refinement](../design-patterns/confidence-based-follow-up-refinement-2026-05-13.md) — the pattern this metric serves
- [absent field beats a defaulted one in a precedence chain](absent-field-beats-defaulted-one-in-a-precedence-chain-2026-07-31.md) — the same preference for admitting uncertainty over papering over it
