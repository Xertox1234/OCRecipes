---
title: Deleting a truthiness guard removes its decision about EVERY falsy value, not just the one you replaced
track: bug
category: logic-errors
tags: [guard-removal, falsy-values, zero, refactoring, regression-testing, fail-silent, nutrition]
module: client
applies_to: ["client/**/*.ts", "client/**/*.tsx", "server/**/*.ts", "shared/**/*.ts"]
symptoms: ["A refactor replaces a null check and something breaks for 0, empty string, or NaN instead", "Every displayed number drops to 0 after an interaction that previously did nothing", "The regression test written alongside the fix passes, because it pins the input the author was thinking about", "A sibling layer already has a fallback for the same input class, with a comment naming it"]
created: 2026-07-30
severity: medium
---

# Deleting a truthiness guard removes its decision about EVERY falsy value, not just the one you replaced

## Problem

`ServingControls`' quantity stepper was guarded like this:

```ts
if (servingSizeGrams) {
  recalculateNutrition(servingSizeGrams, next);
}
```

A fix was landing that made a **null** serving weight a first-class state, so
the guard looked like leftover null-protection and was deleted. It was not. It
was also the only thing classifying `0` — and a zero basis reaching the scaling
path computes `factor = (0 / 100) * quantity`, which is exactly zero.

## Symptoms

- Every macro on the card drops to `0` the first time the user taps `+` or `−`.
  Before the change the same tap silently did nothing, which was wrong but
  harmless.
- The serving label is rewritten to the literal `"0g"`.
- "Add to log" writes a **0-calorie entry** — `servings` is not applied
  server-side, so the client's scaled values are stored verbatim.
- The regression test added with the fix passes: it pins the input class the
  author was reasoning about (a *parseable* serving weight), not the one the
  guard was quietly covering.

## Root Cause

A truthiness guard is a **classifier over the whole falsy set**, not a null
check. Reading `if (x)` as "if x is not null" and replacing it with handling for
`null` alone silently drops `0`, `""`, `NaN`, and `false`.

Here `0` was reachable, and nothing upstream rejected it:

```ts
parseServingGrams("0 ml")            // → 0   (regex is /(\d+\.?\d*)\s*(?:g|ml)(?:\s|$)/)
servingGrams = parseServingGrams(raw) ?? fallback   // ?? keeps 0 — only null/undefined fall through
checkServingPlausibility(...)        // only rejects servings that are too LARGE
// → validateAndNormalizeNutrition's trusted branch returns:
//   { servingInfo: { grams: 0 }, isServingDataTrusted: true }
```

Three separate mechanisms each declined to reject a zero, for individually
defensible reasons. The truthiness guard at the far end was carrying the whole
decision, unremarked.

**The evidence that `0` was reachable was already in the repo.** The server's
own `finalGrams = servingGrams || 100` carries the comment *"guards a
pathological `0 ml` parse"* — a previous author had met this exact input in live
Open Food Facts data and written it down. A `git grep` for the sibling fallback
would have surfaced it before the delete.

## Solution

Normalize at the source so the whole downstream chain sees one "absent" state,
and make the remaining guard state its predicate explicitly:

```ts
// Assignment site — a zero is not a measurement, it is an absence.
const trustedGrams = validated.servingInfo.grams;
setServingSizeGrams(
  trustedGrams != null && trustedGrams > 0 ? trustedGrams : null,
);

// Consumer — `!(grams > 0)`, NOT `grams === null`: null and 0 both produce a
// factor of exactly zero, so both belong on the same branch.
if (!(grams != null && grams > 0)) {
  /* scale the per-serving baseline by quantity instead */
}
```

Fixing it at the source rather than by restoring the component guard also fixed
a second symptom the guard never covered: a `0` reaching the caption skipped the
null branch, matched no option, and rendered **"Per 1 × 0 g"** — a real
measurement of nothing.

## Prevention

- **Before deleting `if (x)`, enumerate what `x` can be.** Write the list out:
  `null`, `undefined`, `0`, `-0`, `NaN`, `""`, `false`. Mark which are reachable
  and decide each one on purpose. If only one is reachable, say so in the commit
  message — that is the audit, recorded.
- **Prefer a named predicate over a bare truthiness test** when the falsy values
  mean different things: `!(grams != null && grams > 0)` cannot be misread as a
  null check the way `if (grams)` can.
- **A fallback in a sibling layer is documentation of an input class.** When you
  find `|| N` / `?? N` on the same value elsewhere in the stack, read its
  comment before assuming the input cannot occur.
- **Regression-test each reachable falsy value, not the motivating one.** The
  test written with this fix covered a parseable serving weight and passed
  throughout — the defect had no coverage because the author never listed `0` as
  an input.
- Note the direction of harm: the old guard's *skip* was a benign no-op; the new
  code's *fall-through* corrupted a health log. A guard that fails safe is
  cheaper to keep than to re-derive.

## Related Files

- `client/components/ServingControls.tsx` — the deleted stepper guard
- `client/hooks/useNutritionLookup.ts` — `recalculateNutrition`'s `!(grams > 0)` diversion and the assignment-site normalization
- `client/lib/serving-size-utils.ts` — `parseServingGrams`, `checkServingPlausibility`, `validateAndNormalizeNutrition`'s trusted branch
- `server/services/barcode-lookup.ts` — `finalGrams = servingGrams || 100`, the sibling guard whose comment named the input class
- `client/hooks/__tests__/useNutritionLookup.test.ts` — the `"0 ml"` fixture

## See Also

- [A replacement must accept everything its predecessors accepted](../conventions/replacement-must-accept-predecessor-inputs-2026-07-30.md) — the same blind spot when new code replaces old, rather than when a guard is deleted outright
- [Relaxing a shared contract requires auditing its dependents](../conventions/relaxing-a-shared-contract-requires-auditing-its-dependents-2026-07-30.md) — the contract-level form: what downstream relied on the guarantee you removed
- [Removing a dead if(!res.ok) guard requires auditing state-cleanup side effects](../conventions/dead-guard-removal-must-audit-state-cleanup-side-effects-2026-06-03.md) — the other axis of guard removal: what the block's BODY was doing, rather than what its CONDITION was classifying
- [Explicitly test falsy boundary values (`0` is not covered by `-1`/`1`)](../best-practices/explicitly-test-falsy-boundary-values-2026-05-13.md) — the testing rule this defect is a live instance of
- [When a refactor swaps a matcher/guard for a BROADER one, regression-test the newly-matched inputs](../best-practices/broadened-matcher-needs-new-input-regression-tests-2026-07-20.md) — the mirror direction: broadening rather than deleting
