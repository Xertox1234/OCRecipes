---
title: "An ordered alternation's fallback branch fires before backtracking can reach the primary — a tolerant branch must exclude what its sibling handles"
track: bug
category: logic-errors
module: client
severity: high
tags: [regex, alternation, backtracking, lazy-quantifier, ocr, nutrition-label, parsing, fault-tolerance]
symptoms: ["A tolerant fallback matches even though the exact form was present", "A numeric value is silently truncated to its first digit or two", "A regex violates an invariant its own comment claims to enforce", "The bug is invisible in every test because the boundary suite only tests one side of the boundary"]
applies_to: ["client/lib/*-ocr-parser.ts", "client/lib/**/*parser*.ts", "server/services/ocr/**/*.ts"]
created: '2026-08-05'
---

# An ordered alternation's fallback branch fires before backtracking can reach the primary

## Problem

MLKit frequently reads the `g` on a nutrition panel as a `9`. Tolerating that requires an
alternation in the unit slot: accept a real `g`, **or** a `9` standing in for one.

```js
//                            ┌ primary ┐ ┌──── fallback ────┐
/…[ \t]+<?(\S+?)(?:\s*g|[ \t]+9(?![\d.]))/i;
```

The intent, stated in the code's own comment, was that a substituted unit must be a **lone
token**. The pattern did not enforce it. On `Total Fat 1 9 g` it returned **1**:

| Input | Returned | Should be |
|---|---|---|
| `Total Fat 1 9 g` | `1` | decline |
| `Total Fat 3 9g` | `3` | decline |
| `Saturated Fat 0 9g 5%` | `0` | decline |

A real `g` was sitting right there, unconsumed, and the fallback fired anyway.

## Symptoms

- The tolerant branch wins while the exact form is present later in the same line
- A macro is truncated (`1.9 g` → `1`) rather than failing to parse
- A guard enforces "X is absent" but never "the alternative was unavailable"

## Root Cause

Two ordinary regex behaviours compose into a trap:

1. **Alternation is ordered and non-backtracking once a branch succeeds.** The engine tries
   `\s*g` first. At capture `"1"` the next non-space character is `9`, so that branch fails —
   and control moves straight to the fallback, which succeeds.
2. **A lazy quantifier expands only on failure.** `(\S+?)` would have grown from `1` to `19`
   and found the real `g`, but only if *every* branch had failed. The fallback succeeding
   stops the search before that happens.

So the fallback did not out-rank the primary — it ran **at a shorter capture length**, before
the engine ever tried the length at which the primary would have matched.

The guards present tested only the substituted token's own shape (`(?![\d.])` — not followed
by digits). Nothing tested for **the primary still being available**, which is the actual
definition of "this is a substitution".

## Solution

A tolerant branch must exclude the case its sibling handles. Add a negative lookahead for the
exact form:

```js
/…[ \t]+<?(\S+?)(?:\s*g(?![a-zà-ÿ])|[ \t]+9(?![\d.])(?![ \t]*g))/i;
//                                              └── "and no real g follows" ──┘
```

All three guards are load-bearing; dropping any one re-opens a real misread:

| Guard | Stops |
|---|---|
| `[ \t]+` | a stray `9` on the *following* line supplying this line's unit |
| `(?![\d.])` | a %DV that lost its `%` (`3 95`) reading as value-plus-unit |
| `(?![ \t]*g)` | firing when the **true** unit is still there |

Resulting behaviour — the regex now resolves exactly the cases a human could, and refuses the
rest:

```
"Total Fat 19 g"   -> 19    backtracks to the real "g"; a true 19 is never read as 1
"Fat / Ipldes 0 9" -> 0     no "g" anywhere; the "9" stands alone
"Glucides 9 9"     -> 9     value and unit are both the glyph "9"
"Total Fat 1 9 g"  -> null  a real "g" follows: not a substitution
"saturés 19"       -> null  AMBIGUOUS: declined, not guessed
```

## Prevention

- **Decline ambiguity instead of resolving it**, wherever the parsed value feeds a precedence
  chain. Here `totalFat` / `totalSugars` / `saturatedFat` go into the `labelNutrition`
  payload, and a wrong value reaches `buildLabelConflict`, whose conflict path replaces the
  database macros wholesale. A missing field falls back to the database; a confident wrong one
  does not. `19` is either 19 grams or `1 g` and the flattened text cannot say which — so
  neither should the parser.
- **Resist the plausible-sounding invariant.** The rejected alternative here was stripping the
  trailing `9` from `2.59` because "labels never print two decimal places". There was no
  evidence for that premise, and it writes a wrong fat value the one time it is false. The
  whitespace-position rule needs no such assumption.
- **Test both sides of the boundary.** The suite written specifically to guard this risk covered
  `3 95`, `3\n9`, `19` and `2.59` — every case that should decline — and no case of the form
  `<digits> <space> 9 <space?> g`. That omission is why the defect shipped green. A boundary
  suite missing one side is not a guard.
- Write the invariant as a sentence first, then check the pattern enforces **all** of it. The
  comment said "lone token"; the regex enforced "not followed by a digit".

## Related Files

- `client/lib/nutrition-ocr-parser.ts` — `FIELD_PATTERNS`, the `g` → `9` block
- `client/lib/__tests__/nutrition-ocr-parser.test.ts` — `declines when a real g is still sitting unconsumed after the 9`

## See Also

- [whitespace-class-silently-sets-extraction-regex-boundary](whitespace-class-silently-sets-extraction-regex-boundary-2026-08-05.md) — the sibling defect in the same alternation
- [absent-field-beats-defaulted-one-in-a-precedence-chain](absent-field-beats-defaulted-one-in-a-precedence-chain-2026-07-31.md) — the same "absent beats confidently wrong" rule, at an API contract boundary
- [disjunctive-gate-alternatives-sharing-one-failure-mode](disjunctive-gate-alternatives-sharing-one-failure-mode-2026-07-30.md) — why `isLabelReady` stopped requiring sugars-or-fat: this exact `g`→`9` glitch nulls both
- [../conventions/fixture-stops-guarding-when-its-defect-is-fixed](../conventions/fixture-stops-guarding-when-its-defect-is-fixed-2026-08-05.md) — fixing this defect disarmed the fixture that documented it
