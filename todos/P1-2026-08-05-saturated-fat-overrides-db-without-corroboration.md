---
title: "saturatedFat overrides the database without ever being compared against it"
status: backlog
priority: high
created: 2026-08-05
updated: 2026-08-05
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

- [ ] A decision is made and written down: either `saturatedFat` joins `cmp`, or it
      is deliberately excluded with the reason stated in the code
- [ ] If it joins `cmp`: `ConflictField` covers it, and the effect on
      `comparedCount` / the `compared` flag is traced, since that flag gates the
      client's one-tap log (recovering `totalFat` already moved it 1 → 2 once)
- [ ] Tests pin the behaviour on both sides — a label whose `saturatedFat` agrees
      with the DB, and one where it disagrees — including what the user sees
- [ ] No change to which labels are _accepted_ (`isLabelReady`) — this is about
      what happens after acceptance
- [ ] The parser docblock note in `client/lib/nutrition-ocr-parser.ts` is updated or
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
