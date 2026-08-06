---
title: "saturatedFat overrides the database without ever being compared against it"
status: done
priority: high
created: 2026-08-05
updated: 2026-08-06
assignee:
labels: [nutrition, label-override, data-integrity]
github_issue:
---

# saturatedFat overrides the database without ever being compared against it

> **`priority: high` here is about MERGE GATING, not urgency.** This changes which
> labels override user health data, so auto-merge must never be armed on its PR —
> `high` is the repo's mechanism for that (same reason slices 2a and 2c carried it).
> The actual severity is medium: the values reaching this path today are sound, and
> the defect is the absence of a check rather than a known wrong number.

## Summary

`buildLabelConflict` writes `saturatedFat` from a photographed label straight into
`mergedPer100g` — and therefore over the database record and into the user's log —
without ever comparing it against the database value, because `saturatedFat` is not
in the `cmp` list that every other payload field passes through.

## Background

Verified in `server/services/label-override.ts` on `main` at `4fdf8b7f`:

```ts
// ~139-143 — four fields are read off the label
if (label.calories != null) per100.calories = label.calories * factor;
if (label.totalSugars != null) per100.sugar = label.totalSugars * factor;
if (label.totalFat != null) per100.fat = label.totalFat * factor;
if (label.saturatedFat != null)
  per100.saturatedFat = label.saturatedFat * factor;

// ~146-151 — but only THREE are compared against the DB
const cmp: [ConflictField, number | undefined, number | undefined][] = [
  ["calories", per100.calories, dbResult.per100g.calories],
  ["sugar", per100.sugar, dbResult.per100g.sugar],
  ["fat", per100.fat, dbResult.per100g.fat],
];

// ~217-220 — and the merge spreads ALL of per100, saturatedFat included
const mergedPer100g: BarcodePer100g = {
  ...per100,
  caffeine: dbResult.per100g.caffeine,
};
```

So once _any other_ field disagrees enough to trigger the conflict path, the label's
`saturatedFat` replaces the database's with no corroboration of its own. It is the
only one of the four payload fields with no independent check.

## Why now

This is pre-existing and was rarely exercised: the OCR parser declined ambiguous
`saturatedFat` reads, so the field was usually `null` and nothing rode through.
PR #760 changed that. `gluedUnitIsForced` now recovers `saturés 19` → 1 g by
containment against total fat, so `saturatedFat` is populated **routinely, and from
an inference rather than a direct glyph read**.

The inference itself is sound — fat containment holds under every labelling regime,
and the review that found this said so explicitly. The point is that the diff moved
a rarely-reached gap onto the common path, and nothing downstream re-checks it:
`shouldReplaceWithAI` (`client/screens/label-analysis-utils.ts`) compares only
calories / totalFat / protein / totalCarbs / sodium, so the AI pass does not correct
a wrong `saturatedFat` either.

Found by `ai-reviewer` during the review of #760. Documented in the parser docblock
and added to `.claude/agents/ai-reviewer.md`, but deliberately not fixed there —
changing `cmp` changes which labels override, which is not a drive-by edit on a
health-data path.

## Acceptance Criteria

- [x] A decision is made and written down: either `saturatedFat` joins `cmp`, or it
      is deliberately excluded with the reason stated in the code
- [x] If it joins `cmp`: `ConflictField` covers it, and the effect on
      `comparedCount` / the `compared` flag is traced, since that flag gates the
      client's one-tap log (recovering `totalFat` already moved it 1 → 2 once) —
      it DID join; `ConflictField` covers it, and `comparedCount` is deliberately
      left unaffected (the field carries `corroborates: false`). See Updates.
- [x] Tests pin the behaviour on both sides — a label whose `saturatedFat` agrees
      with the DB, and one where it disagrees — including what the user sees
- [x] No change to which labels are _accepted_ (`isLabelReady`) — this is about
      what happens after acceptance
- [x] The parser docblock note in `client/lib/nutrition-ocr-parser.ts` is updated or
      removed to match whatever is decided

## Implementation Notes

The obvious fix (add `["saturatedFat", per100.saturatedFat, dbResult.per100g.saturatedFat]`
to `cmp`) is not obviously correct, and that is the whole reason this is a todo:

- It **increases** `comparedCount`, which loosens the `compared: comparedCount >= 2`
  gate — a label that previously could not be trusted for one-tap logging might now
  qualify on the strength of the field with the weakest provenance.
- It also makes `saturatedFat` able to _raise_ a conflict on its own, so a label
  whose macros all agree could start showing the conflict prompt because of one
  inferred saturated-fat value.
- Check `dbResult.per100g.saturatedFat` is actually populated often enough for the
  comparison to mean anything — if the DB usually lacks it, adding it to `cmp`
  mostly adds `undefined`-vs-value non-comparisons.

Weigh those before assuming "add it to the list" is the fix. Excluding it explicitly,
with a comment saying why, may well be the right answer.

## Scope Contract

- **Mechanisms to use:** the existing `cmp` / `ConflictField` machinery — no new
  comparison layer, no new config
- **Files in scope:** `server/services/label-override.ts`,
  `server/services/__tests__/label-override.test.ts`, and the docblock note in
  `client/lib/nutrition-ocr-parser.ts`
- No new mechanisms, files, or abstractions beyond those listed.

## Dependencies

- None blocking. PR #760 (merged as `4fdf8b7f`) is what makes this routine, and it
  is already on `main`.

## Risks

- **This is the user-health-data override path.** A change here alters which
  photographed labels replace database values in someone's food log. Auto-merge must
  not be armed; the PR wants individual review.
- `compared` gates the client's one-tap log, so a change to `comparedCount` has a UI
  consequence well away from this file.
- Easy to "fix" by adding the field to `cmp` and ship a loosened trust gate by
  accident. The acceptance criteria ask for a decision, not a specific edit.

## Updates

### 2026-08-05

- Initial creation. Found by `ai-reviewer` reviewing PR #760; the code facts above
  were re-verified directly in `server/services/label-override.ts` on `main`
  at `4fdf8b7f` rather than taken from the review report.

- **[SUPERSEDED 2026-08-06 — see the entry below. Kept for the record; the code
  no longer does this.] Decision: `saturatedFat` stays OUT of `cmp` — deliberate
  exclusion, documented in the code comment above `cmp` in
  `server/services/label-override.ts`.**
  Two reasons, in order of weight:
  1. The server can't condition on OCR provenance: `labelNutritionSchema` sends
     `saturatedFat` as a bare nullable number, so a confident direct read, an
     ambiguous `gluedUnitIsForced` containment inference, and a plain digit
     misread inside an unambiguous match are all indistinguishable once the
     payload arrives. There is no shape of reading this module could trust
     more than another.
  2. On low-fat products a spurious conflict is cheap to trigger (tight
     tolerance relative to per-serving→per-100 rounding amplification) and
     expensive once triggered (the conflict path blanks the DB's
     carbs/protein/fiber/sodium). Does not hold for high-fat products
     (cheese/butter); the decision does not rest on this case.

  `comparedCount`'s effect (AC #2) was traced as part of weighing the
  decision rather than implemented: `gluedUnitIsForced` requires a
  non-substituted `totalFat` read to promote a saturatedFat inference at all,
  and `fat` is already in `cmp`, so an inferred saturatedFat joining `cmp`
  would rarely be what tips `comparedCount` past the `>= 2` gate on its own —
  a narrower, secondary concern than reason 1 above.

  Accepted residual: a wrong saturatedFat (misread or inferred) can still
  ride into the user's log uncorroborated whenever some OTHER field triggers
  a conflict. Not narrowly bounded — the containment/substitutedUnit guards
  only cover the glued-ambiguous-token path. What partially bounds it: fat
  containment holds under every labelling regime, and the FSA "high in
  saturated fat" flag's wrong-LOW case is caught by the route's lost-flag
  diff (wrong-HIGH is the direction already treated as safe to risk).

  Tests in `server/services/__tests__/label-override.test.ts` pin the
  decision on both the `fields`/`conflict` axis (a disagreeing saturatedFat
  never enters `fields`) and the `comparedCount`/`compared` axis (an
  agreeing saturatedFat never raises `comparedCount`), plus a negative
  control (calories/sugar/fat all agree, saturatedFat disagrees wildly →
  no conflict). Reviewed by `code-reviewer` + `ai-reviewer`, two rounds — no
  CRITICAL findings either round; WARNINGs addressed inline (test
  discrimination gaps, comment precision). See
  `docs/solutions/logic-errors/confidence-must-count-evidence-not-inferences-2026-08-05.md`.

### 2026-08-06

- **The won't-fix above was REJECTED by the user. `saturatedFat` is now
  corroborated.** The exclusion argument — that the server cannot tell a direct
  read from an inference or a plain misread once the payload arrives — is a
  reason to trust the reading LESS, which argues _for_ checking it against the
  record, not for skipping the check. Writing a photographed number over a
  database record and into someone's food log with no comparison of its own was
  the defect; it is closed.

- **What shipped** (`server/services/label-override.ts`):
  1. `"saturatedFat"` added to the `ConflictField` union and to `cmp`. It can
     now raise a conflict on its own and appears in the `fields` list the client
     shows.
  2. A **quantization floor**, `SATURATED_FAT_LABEL_ROUNDING_STEP_G (0.5 g) *
factor`. A field is only called a disagreement when the relative check
     fails AND the absolute gap exceeds that floor. The derivation is traceable
     to labelling rules, not tuned to a test: FDA 21 CFR 101.9(c)(2) and
     CFIA quantize printed saturated fat to 0.5 g steps, both sides of the
     comparison are rounded values whose errors can point in opposite
     directions (≤ `0.25 * (factor + 1)`, which is ≤ `0.5 * factor` for every
     serving under 100 g — the whole band where the floor binds), and the > 5 g/serving 1 g-step rule needs no term because 25% relative already > exceeds it there. Without this, the 2-5 g/100g band conflicts on rounding > alone: on a 30 g serving one 0.5 g printed step is 1.67 g at per-100 scale > while 25% of 4 g is only 1.0 g. A spurious conflict is expensive — it takes > the blank-uncorrected-siblings path and discards the record's > carbs/protein/fiber/sodium.
  3. **`comparedCount` is deliberately UNCHANGED.** The `cmp` rows carry a
     `corroborates` flag; saturatedFat's is `false`, so its agreement never
     counts toward the `compared >= 2` one-tap-log gate. Justification: the
     floor in (2) _is_ a widened agreement test, which makes a saturatedFat
     agreement materially weaker evidence than the other three — the field whose
     check was loosened must not be what tips a trust threshold, or a
     calories + saturatedFat label would reach 2 and claim the sugar, fat,
     protein and sodium on screen had been checked against the package. Both
     halves of the change therefore move protectively: conflicts get easier to
     detect, the trust gate does not get easier to open. The AC's traced risk
     ("might now qualify on the strength of the field with the weakest
     provenance") is closed by construction rather than by argument.
  4. `cmp` was restructured from a tuple list to one list of `FieldComparison`
     records, so the per-field floor and `corroborates` policies live on the row
     rather than in a second parallel array. This area's recent defects were all
     field-parallel structures drifting.

- **Client fix found while tracing the blast radius**:
  `client/components/ScanConflictPrompt.tsx`'s `FIELD_LABEL` map covered only
  calories/sugar/fat and falls back to `?? f`. Since `conflictFields` crosses
  the wire as `string[]`, a new union member is not a type error — the first
  user-visible consequence of shipping the server change alone would have been
  the raw key `saturatedFat` rendered on screen and spoken inside the radio's
  `accessibilityLabel`. Added `saturatedFat: "Saturated Fat (g)"` plus a test.

- **Residual, narrowed but not closed**: a wrong saturatedFat still rides into
  `mergedPer100g` when the RECORD carries no `saturated-fat_100g` to compare
  against and another field conflicts. A comparison can only bound what the
  record can answer. `shouldReplaceWithAI` still does not re-check the field.

- **Tests** (`server/services/__tests__/label-override.test.ts`, 32 cases;
  `client/components/__tests__/ScanConflictPrompt.test.tsx`, 5): disagreement
  beyond the floor conflicts with `"saturatedFat"` in `fields`; a one-printed-
  step gap on a 30 g serving does NOT conflict (verified non-vacuous — it is the
  only test that fails when the `roundingFloor` term is removed); saturatedFat
  agreement does not raise `comparedCount` (verified non-vacuous — the only test
  that fails when `corroborates` is flipped to `true`); and both single-field
  states the asymmetry creates (sole comparable field disagreeing → conflict
  with `comparedCount` 0 and `compared: true`; sole comparable field agreeing →
  `compared: false`).

- Prose asserting the superseded decision was corrected in
  `.claude/agents/ai-reviewer.md`, `client/lib/nutrition-ocr-parser.ts`, and
  both `docs/solutions/logic-errors/*-2026-08-05.md` files.

- **Merge gating unchanged**: `priority: high`, auto-merge NOT armed. This is
  the user-health-data override path and stays individually review-gated.
