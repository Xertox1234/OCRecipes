---
title: A `|| fallback` after a lenient parser catches only the benign failures — the dangerous inputs parse "successfully" and skip it
track: bug
category: logic-errors
module: server
severity: high
tags: [architecture, hooks, client-state, parsing, validation, nutrition, units, fallback, wrong-number, guard]
applies_to: [server/services/**/*.ts, shared/lib/**/*.ts, client/hooks/**/*.ts]
symptoms: [A value is scaled by a wildly wrong factor (100x, 50x) rather than by the intended default, A `|| defaultValue` guard exists but reviewing it does not explain an observed wrong number, parseFloat/parseInt used on a string that carries a unit or a count, A defect is filed as "falls back to the default" but the observed output is not the default]
created: '2026-08-10'
last_updated: '2026-08-16'
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
already does this — it matches an anchored unit alternation (`SERVING_UNIT`, see the
"narrowed hole" subsection below for its current form), preferring a parenthesised
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

### The narrowed hole is still a hole — say so out loud (closed 2026-08-16, P2-2026-08-10)

`(?:g|ml)` was a **prefix** test, not a unit test: the alternation had no word boundary,
so any unit merely *beginning* with `g` or `ml` still parsed as a mass. Measured:

| input          | `parseServingGrams` (before) | should be |
| -------------- | ----------------------------- | --------- |
| `"1 gallon"`   | **1**                          | reject    |
| `"2 glasses"`  | **2**                          | reject    |
| `"3 gummies"`  | **3**                          | reject    |
| `"100 grams"`  | 100                            | 100 ✓     |
| `"250 millilitres"` | **null**                 | 250       |

So it was wrong in both directions — it accepted `"1 gallon"` as one gram and rejected a
spelled-out `"250 millilitres"`. A bare `\b` (`(?:g|ml)\b`) fixes the first three and
**breaks `"100 grams"`**, which is why the fix is an explicit unit alternation with the
`\b` baked into the shared constant itself (not appended separately at each of the two
regexes built from it — an invariant stated on the wrong symbol doesn't travel with it):

```ts
const SERVING_UNIT = String.raw`(?:grammes?|grammi|gramm|grams?|gramos|gramas|gms?|grs|grm|g|millilit(?:re|er)s?|mls?)\b`;
```

pinned by characterisation tests over each caller's real inputs (`SERVING_UNIT` in
`server/services/barcode-lookup.ts`, tests in
`server/services/__tests__/barcode-lookup-normalization.test.ts`) — not a one-character
patch. The vocabulary starts from `shared/lib/label-serving.ts`'s own UNIT constant
(built for a sibling parsing problem: OCR'd printed labels), then adds back
`grammes?`/`gms?`/`mls?` — informal abbreviations and the British spelling that the old
prefix-match happened to accept, and that a real crowdsourced OFF `serving_size` field
plausibly contains even though a printed, OCR'd label rarely spells a unit informally.
Only `"gr"` is deliberately excluded (and stays excluded): on its own it is the symbol
for the apothecary "grain", a genuinely different unit, not a gram abbreviation. Unit
symbols do not pluralize, so `grs`/`grm` are not grain abbreviations and are accepted.
This gap is now closed — do not treat the table above as a live warning.

**The first version of this fix shipped an incomplete vocabulary and had to be widened
in review.** Anchoring is a narrowing, and a narrowing silently drops every spelling the
predecessor accepted *by accident*. The bare-`g` prefix match had been accepting six
real non-English gram spellings — `grammi` (it), `gramos` (es), `gramas` (pt), `gramm`
(de), plus `grs`/`grm` — all of which returned `null` under the first anchored
alternation. OFF is French-founded and internationally crowdsourced, so a `serving_size`
in the contributor's own language is routine, not exotic. Enumerating "the spellings I
can think of" is not the same as enumerating what the predecessor accepted; see
`docs/solutions/conventions/replacement-must-accept-predecessor-inputs-2026-07-30.md`.

The general lesson: **a parser that narrows the hole is an improvement, not a proof.**
When you cite one as "requires the unit", verify the anchor exists before writing that
claim down — an unanchored alternation reads exactly like an anchored one.

### The digit side, not the unit side — and why widening the unit forced the fix (closed 2026-08-16)

`SERVING_GRAMS_PAREN`/`SERVING_GRAMS_BARE`'s digit group (`\d+\.?\d*`) had the same
shape of problem on the other half of the match. A comma-decimal serving size — routine
in EU-sourced OFF `serving_size` free text, e.g. `"12,5 g"` — did not parse as 12.5.
`\d+` stops at the comma; the regex engine then retries starting from the `5`, and the
alternation matches `"5 g"` — returning **5**, silently. `!(grams > 0)` is true for 5,
so the wrong value sailed through `normalizeToPerHundredGrams` and scaled nutrition by
`100/5 = 20×` instead of the correct `100/12.5 = 8×`, a 2.5× inflation.

**This was first filed as pre-existing and orthogonal to the unit fix. It was neither.**
Adding the European unit spellings (`millilit(?:re|er)s?`, then `grammi`/`gramos`/
`gramas`/`gramm`) widened the set of inputs that reach the digit group — and comma
decimals travel with exactly those spellings. Measured, main vs the unit-fix branch:

| input                | before the unit fix | after the unit fix alone |
| -------------------- | ------------------- | ------------------------ |
| `"12,5 g"`           | 5 (pre-existing)    | 5                        |
| `"12,5 millilitres"` | **null**            | **5** — newly wrong      |

The general form: **widening a parser's vocabulary can newly reach a latent bug on an
orthogonal axis of the same match.** "Pre-existing" describes the code, not the
exposure. Before deferring a known gap as out-of-scope, check whether the change in hand
increases the input set that reaches it — if it does, it is in scope.

Closed by making the comma a first-class decimal separator in a shared figure constant,
normalized before `parseFloat` (which understands only `.`):

```ts
const SERVING_FIGURE = String.raw`(\d+(?:\.\d*|,\d{1,2})?)`;
// ...
return m ? parseFloat(m[1].replace(",", ".")) : null;
```

The asymmetry between the two branches is deliberate. `\.\d*` reproduces the
predecessor's dot handling byte-for-byte. `,\d{1,2}` is bounded because a comma before
exactly three digits is genuinely ambiguous — `"1,000"` is 1 in the EU and 1000 in the
US — so the group declines to consume it and falls through to a 0 that every caller
already refuses, rather than guessing. The obvious-looking `[.,]?\d*` would instead read
`"1,000 g"` as **1 g**: a plausible, sub-`MAX_PLAUSIBLE_SERVING_GRAMS` value that ships
as `isServingDataTrusted: true` — newly *accepting* a 1000× error where the code it
replaced rejected it. A "simplification" of that regex is a regression; the tests pin
the case.

**Residual, still open and unchanged from before this fix:** `"0,125 g"` → 125 and
`"2,500 ml"` → 500 are still wrong, for the same ambiguity reason — comma-plus-three-
digits is refused, so the engine falls through to the trailing digits. Both are
implausible as real serving sizes, which is why guessing was not worth the wrong-half-
the-time cost. Stated out loud rather than left implied, per this document's own thesis.

Then make every caller handle the refusal. A nullable return is what forces this: the
type checker enumerates the call sites for you. **Discard the value; never substitute a
default at the call site**, or you have reintroduced the same bug one level up.

## Prevention

- Never `parseFloat` a string that carries a unit. If the unit is what makes the number
  meaningful, the parser must require it — and **anchor** it. `(?:g|ml)` matches the
  first two letters of `"gallon"`. An anchor alone is not the fix: `(?:g|ml)\b` blocks
  `"gallon"` but also `"grams"` (its own unit word merely continues past the `g`) — the
  alternation must list every accepted spelling explicitly, THEN anchor the whole thing
  (see `SERVING_UNIT` above).
- Treat `x = parse(...) || DEFAULT` as a smell. Ask which inputs reach the `||` — if a
  lenient parser sits on the left, the answer is usually "only the ones that were
  already obvious."
- **A known-but-deferred gap stops being out-of-scope the moment your change widens the
  inputs that reach it.** "Pre-existing" describes the code, not the exposure. Before
  filing one as orthogonal, run the new inputs through it and compare against the base
  branch — a `null` that becomes a plausible wrong number is a regression your diff
  caused, whoever wrote the bug.
- When a fix must guess between two incompatible readings of the same input (EU vs US
  decimal comma), prefer the form that **refuses** over the form that picks one. A
  refusal is caught by the caller's existing guard; a wrong-but-plausible number is not.
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
