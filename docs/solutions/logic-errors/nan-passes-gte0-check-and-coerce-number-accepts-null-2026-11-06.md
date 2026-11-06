---
title: "A \"NaN\" string passes a decimal column's >= 0 CHECK and turns a day's SUM into NaN — and z.coerce.number() is Number(v), so it lets null, true and [] through as numbers"
track: bug
category: logic-errors
tags: [api, database, zod, postgres, numeric, nan, validation, nutrition, check-constraint]
module: server
symptoms: ["one food log makes the whole day's totals NaN (daily summary, goals, coach context, notifications)", "a numeric field accepts \"abc\" or \"-5\" and the insert 500s from Postgres", "after switching a validator to z.coerce.number(), calories: null is stored as 0 kcal"]
created: 2026-11-06
severity: medium
---

# A "NaN" string passes a >= 0 CHECK, and z.coerce.number() accepts null/true/[]

## Problem

`numericStringField` (`server/routes/_schemas.ts`) accepted any string or number and called `.toString()`. It fed POST `/api/scanned-items` (manual, voice, offline queue) and the meal-plan schemas. "NaN" reached a `decimal(10,2)` column whose `CHECK (calories >= 0)` let it in, and `getDailySummary` summed the whole day to NaN.

## Symptoms

- `'NaN'::numeric(10,2) >= 0` is **true** in Postgres (NaN sorts above every number); `NaN + 5` is NaN.
- `"abc"` / `"-5"` only failed at the database, as a 500.

## Root Cause

Two separate traps:

1. **Postgres NaN beats a CHECK.** A `>= 0` CHECK does not exclude NaN, so the column constraint is no guard against it. Only the boundary is.
2. **`z.coerce.number()` is `Number(v)`.** The first fix used it and was caught in review: `Number(null) === 0`, `Number(true) === 1`, `Number([]) === 0`, `Number("0x10") === 16`, `Number("  ") === 0`. The old `z.union([z.string(), z.number()])` rejected those, so the "stricter" schema accepted more. `calories: null` on a manual log would have stored a silent 0 kcal. In zod 3.25, `z.number()` also accepts `Infinity`, so `.finite()` is required.

## Solution

`boundedNumericStringField(max, { nullable? })` in `server/routes/_schemas.ts`:

- `z.preprocess` trims strings and maps a blank string to absent.
- `z.union([z.number(), z.string().regex(/^\d*\.?\d+(e[-+]?\d+)?$/i).transform(Number)])` — only a number or a decimal string (the exponent form is what `Number#toString` writes for tiny values).
- `.pipe(z.number().finite().min(0).max(max))`, then `.toString()`.
- Per-field caps come from `NUTRITION_CAPS` in `shared/constants/nutrition.ts` (calories 50,000, macros 5,000 g, sodium 100,000 mg, servings 999.99).

## Prevention

- Never put `z.coerce.number()` on a boundary on its own — check the input's type (number or decimal-string regex) first, then coerce.
- A numeric validator change gets probe rows for `null`, `true`, `[]`, `"  "`, `"0x10"`, `"NaN"`, `"Infinity"` and a value over the cap.
- Don't rely on a `>= 0` CHECK to exclude NaN.

## Related Files

- `server/routes/_schemas.ts`, `server/routes/__tests__/_schemas-numeric.test.ts`
- `shared/constants/nutrition.ts` (`NUTRITION_CAPS`)
- `server/routes/nutrition.ts`, `server/routes/_meal-plan-schemas.ts`

## See Also

- `docs/solutions/logic-errors/zod-ingestion-validation-stricter-than-readers-2026-05-29.md` (ingestion schemas must not be stricter than their readers — the opposite direction)
