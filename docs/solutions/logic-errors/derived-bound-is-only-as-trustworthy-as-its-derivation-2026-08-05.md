---
title: "A derived bound is only as trustworthy as the derivation that produced it — a non-null check is not a trust check"
track: bug
category: logic-errors
tags: [ocr, parsing, inference, nutrition, validation, plausibility, trust-propagation]
module: client
applies_to: ["client/lib/nutrition-ocr-parser.ts", "client/lib/**/*.ts", "shared/lib/**/*.ts"]
symptoms: ["A plausibility rule adopts a value that is wrong by an order of magnitude", "The rule's guard checks only that the reference field is non-null", "The reference field was itself read through the same tolerant path the rule is adjudicating", "A field that used to decline now returns a confident number, and the change looks like recall improvement"]
severity: critical
created: 2026-08-05
last_updated: 2026-08-06
---

# A derived bound is only as trustworthy as the derivation that produced it — a non-null check is not a trust check

## Problem

`nutrition-ocr-parser.ts` resolves an ambiguous OCR reading by containment: a
glued `saturés 19` is either "19" or "1 g", and 19 g of saturated fat cannot fit
inside a label's own 11 g of total fat, so only the unit reading survives. The
guard read:

```ts
const bound = parent ? result[parent] : null;
if (bound === null) return false;   // "a wrong parent must never promote a child"
```

The comment states the invariant. The code only checks for absence. And the
parent can be **present and corrupt**, because it may have been read through
the very same unit-substitution tolerance the rule is adjudicating:

```
"Total Fat 129 9%\nSaturated 259"  ->  totalFat = 129, saturatedFat = 25
```

`Total Fat 129 9%` matches the *spaced* substitution branch: the `9` taken as
the unit is a daily value that lost its `%`, so `totalFat` reads 129 where the
package says something near 12.9. Containment then forced `Saturated 259` to 25,
because `259 > 129` and `25 <= 129`. Both numbers reach the server override.

## Symptoms

- A value an order of magnitude out, adopted with no warning
- The guard's own comment claims a trust property the code does not implement
- Reproducing needs two fields, so single-field unit tests never surface it
- The bad adoption is NEW in the change that added the rule — the field used to
  decline, so it reads as a recall improvement in the diff

## Root Cause

Trust does not propagate for free. The rule was written as though `result` held
facts, when `result` holds *readings* — some direct, some produced by exactly
the tolerance being reasoned about. Two ambiguous readings do not add up to one
certain one, and a check for `null` cannot tell them apart because both a
confident read and a tolerated one land as ordinary numbers.

The invariant was actually stated correctly in prose. What was missing is that
"wrong parent" and "absent parent" are different conditions, and only one of
them was implemented.

## Solution

Record *how* each value was obtained, and let the rule refuse the derivations it
cannot lean on. Here the regex gained a capture group on the spaced-substitution
branch, so a match distinguishes "unit was a real `g`" from "unit was a
substituted glyph":

```ts
const substitutedUnit = new Set<NumericField>();
// ... first pass: result[key] = value; if (match[2]) substitutedUnit.add(key);

// containment:
if (substitutedUnit.has(parent)) return false;
const bound = result[parent];
if (bound === null) return false;
```

The marked values are still adopted for themselves — they are direct reads. They
just cannot vouch for anything else. Pin the exact two-field chain as a
regression test, plus a negative control proving containment against a
real-unit parent still works.

## Prevention

- When a rule reasons over previously-parsed values, ask **how each one was
  obtained**. If any path to it was tolerant, heuristic, defaulted or inferred,
  a plausibility check built on it inherits that uncertainty.
- `!= null` is an existence check. If the code comment says "trustworthy",
  "valid" or "correct", the guard needs to test that property, not presence.
- Adding a tolerance rule can weaponise a *pre-existing* weakness elsewhere.
  Before shipping one, look for the field it will consult and ask what the
  worst value that field can currently hold is.
- Cross-field rules need cross-field tests. A suite organised one field per case
  structurally cannot reach them.

## Related Files

- `client/lib/nutrition-ocr-parser.ts` — `gluedUnitIsForced`, `PARENT_FIELD`, the `substitutedUnit` set
- `client/lib/__tests__/nutrition-ocr-parser.test.ts` — "declines a parent whose own unit was substituted" and its negative control
- `server/services/label-override.ts` — where these values land. `saturatedFat` IS corroborated by `cmp`, behind a clamped floor derived from the label's 0.5 g printing step — but **only when the payload's `directReads` says the parser read it directly.** A value this rule INFERRED is still adopted and never compared, because the inference's error is bounded by `[0, totalFat]` while the floor is sized for a 0.5 g print step. That is the downstream half of this same lesson: a bound is only as trustworthy as its derivation, so the derivation has to survive the trip across the wire

## See Also

- [regime-dependent invariant on mixed-provenance data](regime-dependent-invariant-breaks-on-mixed-provenance-data-2026-08-05.md) — the sibling defect in the same rule: the bound itself was invalid, not just the parent
- [a trust flag derived from the wrong signal](trust-flag-conflated-with-secondary-source-agreement-2026-07-16.md) — same family: a trust property computed from something that does not carry it
- [absent field beats a defaulted one in a precedence chain](absent-field-beats-defaulted-one-in-a-precedence-chain-2026-07-31.md) — why a confident wrong value outranks a missing one in the bad direction
- [alternation fallback fires before backtracking to primary](alternation-fallback-fires-before-backtracking-to-primary-2026-08-05.md) — the regex-level trap in the same parser
