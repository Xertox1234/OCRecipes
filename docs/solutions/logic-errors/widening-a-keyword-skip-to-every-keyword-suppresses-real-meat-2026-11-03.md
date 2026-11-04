---
title: "Widening a negation skip from one keyword to every keyword let a spaced 'free' hide real meat ('chicken free of antibiotics')"
track: bug
category: logic-errors
tags: [architecture, typescript, diet-conflicts, matcher, regex, over-flag, safety]
module: shared
applies_to: ["shared/constants/diet-conflicts.ts", "shared/constants/allergens.ts"]
symptoms: ["A vegetarian/vegan recipe with real chicken or beef shows no diet-conflict icon", "deriveRecipeDietConflicts(['chicken free of antibiotics']) returns [] where main returned ['poultry']", "Hand-written tests for the new skip all pass; only a generated or adversarial probe finds the gap"]
created: 2026-11-03
severity: medium
---

# Widening a negation skip from one keyword to every keyword let a spaced "free" hide real meat

## Problem

`deriveRecipeDietConflicts` had a `MEAT_FREE_SUFFIX` skip, so "meat-free" and "meat free" did not flag
meat. It refused only "free range". PR #1719 generalised it to every conflict keyword so that
"chicken-free" stopped over-warning. The refusal list stayed `range` plus a new `from`. A spaced "free"
followed by any other word now suppressed the flag for 37 keywords instead of one. "chicken free of
antibiotics", "chicken free-roaming", "beef free to roam" and "pork free of nitrates" all returned `[]`
where main flagged them. That is the dangerous direction: real meat left unflagged.

## Symptoms

- Real meat phrasing loses its conflict; substitute phrasing is correctly cleared, so the change looks right.
- Every hand-written test passes. The tests named the exceptions the author already had in mind
  ("free-range", "free from") and nothing else.

## Root Cause

The skip had been proven safe for one keyword's phrasing. For "meat", "meat free <word>" is almost always a
substitute product. Once the skip covers chicken, beef or pork, the word after "free" usually describes
the real animal instead ("free of", "free-roaming", "free to roam"). A refusal list is a denylist, and the
wider skip needed a structural limit rather than a longer list.

## Solution

Split by spelling (`SUBSTITUTE_SUFFIX` in `shared/constants/diet-conflicts.ts`):

- A **spaced** "free" counts only at the end of the phrase: end of string, `,`, `;`, `/` or `(`.
  This keeps "meat free" and "meat free, vegan".
- The **hyphenated** "-free" compound ("meat-free mince", "chicken-free nuggets") may carry a following
  word but refuses range/roam/run/from/of/living/to.
- "-less" needs the hyphen: "chicken less salt" is chicken.

Each reported input became a must-still-flag test row.

## Prevention

- When a skip that suppresses a safety flag widens from one key to many, re-derive what may follow (or
  precede) the trigger word for each new key. Don't reuse the old exception list.
- Prefer a structural limit (end of phrase, hyphenation) over a refusal denylist.
- Run `bash scripts/harness/verdict-diff.sh` on any change to `diet-conflicts.ts` or `allergens.ts`. It
  generates keyword × modifier rows and lists every base-vs-head change. Read every row that moves toward
  `[]` as a possible under-warning, not just the ones the todo named.
- A reviewer probe of descriptor words after the trigger ("free of", "free-roaming", "free to roam")
  found this. The author's corpus could not, because it was built from the cases already expected.

## Related Files

- `shared/constants/diet-conflicts.ts`: `SUBSTITUTE_SUFFIX`, `conflictKeywordHits`
- `shared/constants/__tests__/diet-conflicts.test.ts`: the must-still-flag rows
- `scripts/harness/verdict-diff.sh`: the base-vs-head keyword comparison

## See Also

- [allergen plant-substitute false positive](allergen-keyword-matcher-plant-substitute-false-positive-2026-05-20.md) — the before-keyword counterpart of this guard
- [ambiguous separator must fail toward over-flag](../conventions/safety-classifier-ambiguous-separator-fail-safe-direction-2026-07-21.md) — the same safety asymmetry, for the joining character
- [presence matcher false-flags the negated form](presence-matcher-false-flags-negated-free-from-form-2026-07-22.md) — the opposite failure: a negation not handled at all
