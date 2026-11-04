---
title: parseFloat on a recipe quantity reads only the leading integer — fractions, mixed numbers and ranges are silently under-counted
track: bug
category: logic-errors
module: server
severity: low
tags: [architecture, parsing, quantity, fractions, grocery, pantry, recipe-import, reliability]
applies_to: [server/services/grocery-generation.ts, server/services/pantry-deduction.ts, server/services/**/*.ts, shared/lib/quantity.ts]
symptoms: [Grocery list shows 1 cup where the recipes call for 1/2 cup + 1/2 cup, '"1 1/2 cups" sums as 1', '"2-3 cloves" sums as 2 (lower end of the range)', Pantry deduction leaves the wrong remainder, Summed quantities persist as 0.30000000000000004]
created: 2026-10-30
---

# parseFloat on a recipe quantity reads only the leading integer — fractions, mixed numbers and ranges are silently under-counted

## Problem

Grocery aggregation (`generateGroceryItems`) and pantry deduction (`deductPantryFromGrocery`) summed ingredient quantities with `parseFloat(ing.quantity)`. Recipe quantities are free text, and `parseFloat` stops at the first character it cannot read as part of a decimal number, so it returns a number for most of these strings. The `isNaN` guard never fires and the wrong value goes straight into the sum.

| Input          | `parseFloat` | Intended |
| -------------- | ------------ | -------- |
| `"1/2"`        | 1            | 0.5      |
| `"3/4 lb"`     | 3            | 0.75     |
| `"1 1/2 cups"` | 1            | 1.5      |
| `"1-1/2"`      | 1            | 1.5      |
| `"2-3 cloves"` | 2            | 3 (upper end: never under-buy) |
| `"½"`          | NaN          | 0.5      |
| `"-1"`         | -1           | null     |

The float sums were also persisted unrounded (`0.1 + 0.2`).

## Root Cause

`parseFloat` is a prefix parser. It reports success for any string that starts with a digit. The first fix (normalize the whole string with `normalizeQuantityToDecimal`, then fall back to `parseFloat`) still had the same bug: `normalizeQuantityToDecimal` only accepts a string that is entirely a quantity, so `"1/2 cup"` failed there and fell back to `parseFloat`, which returned 1. Reviewers caught it in the same PR. Any fallback that ends in `parseFloat` brings the bug back.

## Solution

`parseQuantityForSum` in `server/services/grocery-generation.ts` handles each case in order:

1. **Hyphenated mixed number first.** `HYPHEN_MIXED_RE` (`/^(\d+)-(\d+\/\d+)(?=\s|$)/`) rewrites `"1-1/2"` to `"1 1/2"` before the range split, so the string is not read as the range 1 to ½.
2. **Leading token, not `parseFloat`.** `parseLeadingQuantity` tries the whole string with `normalizeQuantityToDecimal`. If that fails, it extracts the leading token with `LEADING_QTY_RE` (mixed number, digit plus glyph, fraction, decimal, or glyph, with a `(?![\d/.])` lookahead so a token is never cut short) and normalizes only that token.
3. **Ranges use the upper end.** `RANGE_RE` splits on `-`, `–`, `—` or `to`, and each side goes through the leading-token parse (`"1/2 to 1 cup"` gives 1).
4. **Negatives return null.** A leading `-` never matches the token regex.
5. **Round when summing or subtracting.** `roundQuantity` (2 dp) is applied to every running sum and remainder.

```ts
// BEFORE — "1/2 cup" → 1, "2-3 cloves" → 2
const raw = ing.quantity ? parseFloat(ing.quantity) : null;
const qty = raw !== null && !isNaN(raw) ? raw : null;
// AFTER
const qty = parseQuantityForSum(ing.quantity);
existing.quantity = roundQuantity(existing.quantity + qty);
```

## Prevention

- Never use `parseFloat`/`Number`/`parseInt` on a human-entered or scraped quantity, either as the main path or as a fallback. Use `parseQuantityForSum` to sum quantities, or `normalizeQuantityToDecimal` (`shared/lib/quantity.ts`) when the string must be a quantity and nothing else.
- Test with quantities followed by text (`"1/2 cup"`, `"1 1/2 cups"`, `"2-3 cloves"`), not only bare numbers. A test with only bare inputs (`"1/2"`) passed the first, still-buggy fix.
- Round any float sum before persisting it.

## Related Files

- `server/services/grocery-generation.ts` — `parseQuantityForSum`, `parseLeadingQuantity`, `roundQuantity`
- `server/services/pantry-deduction.ts` — `deductPantryFromGrocery` (consumer)
- `shared/lib/quantity.ts` — `normalizeQuantityToDecimal` (whole-string normalizer)
- `server/services/__tests__/grocery-generation.test.ts`, `server/services/__tests__/pantry-deduction.test.ts`

## See Also

- `docs/solutions/conventions/decimal-quantity-column-requires-null-coercion-2026-07-13.md`
- 2026-10-30 reliability audit R36 (the server-reviewer and code-reviewer flagged the parseFloat fallback; fixed in the same PR)
