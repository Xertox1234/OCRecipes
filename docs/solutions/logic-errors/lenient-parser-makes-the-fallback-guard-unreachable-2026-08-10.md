---
title: A `|| fallback` after a lenient parser catches only the benign failures — the dangerous inputs parse "successfully" and skip it
track: bug
category: logic-errors
module: server
severity: high
tags: [parsing, validation, nutrition, units, fallback, wrong-number, latent, guard]
applies_to: [server/services/**/*.ts, shared/lib/**/*.ts, client/hooks/**/*.ts]
symptoms: [A value is scaled by a wildly wrong factor (100x, 50x) rather than by the intended default, A `|| defaultValue` guard exists but reviewing it does not explain an observed wrong number, parseFloat/parseInt used on a string that carries a unit or a count, A defect is filed as "falls back to the default" but the observed output is not the default]
created: '2026-08-10'
---

# A `|| fallback` after a lenient parser catches only the benign failures

## Problem

Code parses a number out of a human-readable string and guards the result with a
default:

```ts
const grams = parseFloat(data.servingSize) || 100; // WRONG
const factor = 100 / grams;
```

The guard reads as "if we can't parse it, assume 100 g." It does not do that. It only
fires when the parser returns something **falsy** — and a lenient parser like
`parseFloat` returns a *plausible-looking number* for exactly the inputs you most
needed to reject:

| input            | `parseFloat` | guard fires? | resulting factor        |
| ---------------- | ------------ | ------------ | ----------------------- |
| `"one serving"`  | `NaN`        | yes          | 1 (the intended default) |
| `"1 serving"`    | **`1`**      | **no**       | **100** — 100× inflation |
| `"2 cups"`       | **`2`**      | **no**       | **50** — 50× inflation   |
| `"1 cup (240g)"` | **`1`**      | **no**       | **100**, correct is 0.417 — **240× error** |

The fallback covers the harmless case (nothing numeric at all) and is structurally
unreachable for the harmful ones. The more realistic the label string, the more likely
it starts with a count — so the guard's coverage is *inversely* correlated with real
input.

## Symptoms

- An observed wrong number is not the configured default, yet the only guard in the
  code path is a `|| default`.
- Nutrition/measurement values off by a round factor (100×, 50×) rather than slightly off.
- A todo or bug report describes the failure as "falls back to N" but the reproduction
  shows a different magnitude entirely.
- `parseFloat` / `parseInt` applied to a string that also carries a unit or a count.

## Root Cause

`parseFloat` parses a **leading numeric prefix** and discards the rest. It has no
concept of the unit that gives the number meaning. `"1 serving"` and `"1 cup (240g)"`
both parse to `1` because that is literally the first token — the parser succeeded, so
the `||` never ran.

Two distinct failure modes were collapsed into one guard:

1. **no number at all** → falsy → guard fires → mislabelled but same magnitude.
2. **a number that is not the quantity you want** → truthy → guard skipped → wrong by
   the ratio between the count and the real measure.

Only (1) was ever considered. `||` also swallows a legitimate `0`, silently converting
"zero grams" into the default rather than rejecting it.

## Solution

Parse with something that **requires the unit**, and return an explicit failure instead
of a default. In OCRecipes, `parseServingGrams` (`server/services/barcode-lookup.ts`)
already does this — it matches `(\d+\.?\d*)\s*(?:g|ml)`, preferring a parenthesised
figure:

```ts
export function normalizeToPerHundredGrams(
  data: NutritionData,
): BarcodePer100g | null {
  const grams = parseServingGrams(data.servingSize);
  // `!(grams > 0)` rather than `<= 0` so a NaN basis is rejected too.
  if (grams === null || !(grams > 0)) return null;
  const factor = 100 / grams;
  ...
}
```

It rejects `"1 serving"` and `"2 cups"` outright and correctly reads `240` out of
`"1 cup (240g)"` — the case bare `parseFloat` got wrong by 240×.

### The narrowed hole is still a hole — say so out loud

`(?:g|ml)` is a **prefix** test, not a unit test: the alternation has no word boundary,
so any unit merely *beginning* with `g` or `ml` still parses as a mass. Measured:

| input          | `parseServingGrams` | should be |
| -------------- | ------------------- | --------- |
| `"1 gallon"`   | **1**               | reject    |
| `"2 glasses"`  | **2**               | reject    |
| `"3 gummies"`  | **3**               | reject    |
| `"100 grams"`  | 100                 | 100 ✓     |
| `"250 millilitres"` | **null**       | 250       |

So it is wrong in both directions — it accepts `"1 gallon"` as one gram and rejects a
spelled-out `"250 millilitres"`. Swapping in a bare `\b` (`(?:g|ml)\b`) fixes the first
three and **breaks `"100 grams"`**, which is why the correct repair is an explicit unit
alternation (`(?:g|grams?|ml|millilitres?|milliliters?)\b`) pinned by characterisation
tests over each caller's real inputs — not a one-character patch.

The general lesson: **a parser that narrows the hole is an improvement, not a proof.**
When you cite one as "requires the unit", verify the anchor exists before writing that
claim down — an unanchored alternation reads exactly like an anchored one.

Then make every caller handle the refusal. A nullable return is what forces this: the
type checker enumerates the call sites for you. **Discard the value; never substitute a
default at the call site**, or you have reintroduced the same bug one level up.

## Prevention

- Never `parseFloat` a string that carries a unit. If the unit is what makes the number
  meaningful, the parser must require it — and **anchor** it. `(?:g|ml)` matches the
  first two letters of `"gallon"`; only `(?:g|ml)\b` matches the unit.
- Treat `x = parse(...) || DEFAULT` as a smell. Ask which inputs reach the `||` — if a
  lenient parser sits on the left, the answer is usually "only the ones that were
  already obvious."
- Prefer `!(x > 0)` over `x <= 0` when rejecting a numeric basis: it rejects `NaN` too.
- When narrowing a parser, pin the **current producers' inputs as characterisation
  tests first**, then mutate: the fix cases must go RED and the characterisation cases
  must stay GREEN. A one-sided check cannot distinguish "my tests catch the bug" from
  "my tests pin the wrong thing." See
  `docs/solutions/conventions/gate-test-needs-two-sided-negative-control-2026-07-25.md`.

## Related

- `docs/solutions/conventions/replacement-must-accept-predecessor-inputs-2026-07-30.md`
  — the counterweight: a stricter parser must still accept everything the real
  producers emit. Pin those first.
- `docs/solutions/logic-errors/truthiness-guard-deletion-drops-unanalyzed-falsy-cases-2026-07-30.md`
  — removing a truthiness guard drops its decision about *every* falsy value, not just
  the one you were thinking about.
