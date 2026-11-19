---
title: "An ingredient unit alternation without a trailing word boundary eats the start of the name — \"3 lemons\" parsed as 3 l \"emons\""
track: bug
category: logic-errors
tags: [architecture, api]
module: server
applies_to: ["server/services/recipe-import.ts", "server/services/grocery-generation.ts", "server/services/recipe-generation.ts"]
symptoms: ["Imported ingredient names missing their first letter: \"emons\", \"reen onions\", \"itre stock\", \"zies\"", "Grocery merges and pantry matches miss items that look identical to the user", "A quantity like \"2-3\" or \"1,5\" split into a number plus a name starting with \"-3\" or \",5\"", "parseQuantityForSum(\"1,000\") === 1"]
created: '2026-11-19'
severity: medium
---

# An ingredient unit alternation without a trailing word boundary eats the start of the name

## Problem

`parseIngredientString` (recipe import) matched
`^(qty)?\s*(tablespoons?|…|g|l)?\s*(.+)` with nothing after the unit group. A
regex alternation takes the first alternative that matches *at that position*,
so any name beginning with a unit's letters was cut: `"3 lemons"` → unit `l`,
name `"emons"`; `"2 green onions"` → `g` + `"reen onions"`; `"4 ozzies"` →
`oz` + `"zies"`. The quantity group also had no notion of ranges or decimal
commas, so `"2-3 cloves garlic"` gave name `"-3 cloves garlic"`.

## Symptoms

See frontmatter. The audit row named only the range/period/can-size cases; the
missing boundary was found by probing controls ("3 lemons", "2 green onions")
— a corpus of names that START with unit letters is what exposes it.

## Root Cause

An optional group followed by `\s*` and a greedy `(.+)` never has to prove the
unit ended; there is always a parse that "works".

## Solution

Reliability audit 2026-11-19, M-xc-2 / L-xc-6:

- Unit must end at a boundary: `(?:(UNITS)\.?(?=[\s,;/]|$))?` — accepts
  "1 tsp. salt", "1 cup, packed", "1 tbsp/15ml", rejects "3 lemons".
- Quantity is a number or a range of two (`-`, `–`, `—`, `to`), kept as the raw
  substring; `parseQuantityForSum` reads ranges (upper bound) and commas.
- One comma rule in `parseQuantityForSum`: well-formed thousands groups with a
  non-zero lead (`1,000`, `1,000,000`) drop commas; any other comma is decimal
  (`1,5`, `0,125`). A leading `0,` is never a thousands group — the first
  version read `"0,125"` as 125.

## Prevention

- Test a generated corpus of quantity forms × unit words × names that start
  with unit letters, against the old regex, before shipping a parser change.
- Time adversarial 10k-char inputs (`"1 to "` repeated, nested brackets) — the
  trailing `(.+)` always matches, so this shape cannot backtrack, but a changed
  shape might.

## Related Files

- `server/services/recipe-import.ts` — `INGREDIENT_RE`, `parseIngredientString`
- `server/services/grocery-generation.ts` — `normalizeQuantityCommas`, `parseQuantityForSum`
- `server/services/recipe-generation.ts:108` — a separate copy; its `\s+` after the unit avoids this bug

