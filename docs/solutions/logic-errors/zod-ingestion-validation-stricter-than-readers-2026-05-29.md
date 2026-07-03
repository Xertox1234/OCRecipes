---
title: A Zod ingestion schema stricter than its readers is a new silent failure
track: bug
category: logic-errors
module: server
severity: medium
tags: [zod, validation, typescript, nutrition-pipeline, silent-failure, reliability]
symptoms: [A third-party lookup that used to return data now returns null/empty, One bad row/sibling in an upstream response drops the whole valid result, '`.default(0)` does not stop a `null` from failing `z.number()`', A wrong-typed present value (e.g. `"N/A"` string) passes `.optional()` but still rejects the parent object parse]
created: '2026-05-29'
last_updated: '2026-05-31'
---

# A Zod ingestion schema stricter than its readers is a new silent failure

## Problem

While adding Zod `safeParse` validation to third-party nutrition ingestion paths (CNF, USDA-UPC, Open Food Facts) during the 2026-05-29 reliability audit, the new schemas were **stricter than the code that consumes them**. The intended fix (stop trusting untrusted upstream shapes) introduced a *new* silent failure: valid data was rejected and the lookup fell through to `null`/empty — the exact "fails quietly" class the audit was closing.

## Symptoms

- A branded-food (USDA-UPC) lookup that previously matched now returns no product, because one **sibling** food in the same response page had `value: null`.
- A CNF nutrient lookup drops because an **unread** field (`food_code`, `nutrient_name_id`) was `null` in the upstream row.
- No error is thrown — the `!parsed.success` branch silently `continue`s / `return null`s.
- An Open Food Facts lookup returns no product because a single nutriment field (e.g. `sugars_100g`) is `"N/A"` — a wrong-typed-present value that `.optional()` tolerates but `z.number()` rejects, dropping the entire food object.

## Root Cause

Three distinct Zod footguns, all = "schema demands more than the reader needs":

1. **`.default(0)` does not catch `null`.** `z.number().optional().default(0)` supplies `0` only when the value is `undefined`. Upstream APIs (USDA) return `value: null` for no-data nutrients; `null` fails `z.number()` and rejects the whole object. The pre-existing `f.value || 0` had tolerated `null` — the schema regressed it.
2. **Validating fields the code never reads.** `cnfNutrientAmountListSchema` required `food_code`/`nutrient_name_id` strictly, but only `nutrient_web_name`/`nutrient_value` are ever read. A `null` in a never-read field failed the parse and dropped a usable result.
3. **`.optional()` does not catch wrong-typed present values.** `z.string().optional()` tolerates `undefined`/absent, but `"N/A"` is a present string — when the consuming code expects a number (e.g. via `Number(f.sugars_100g) || 0`), the Zod schema `z.number().optional()` fails the whole object parse even though `.optional()` only guards absence. Open Food Facts returns `"N/A"` for unreported nutrients, and the whole object parse rejects the food unless the numeric field defangs such values.

Compounded by **whole-array/whole-response parsing**: one bad element fails `safeParse` for the entire batch (all 3 USDA candidate foods, the entire CNF list, an entire OFF product), so a single upstream irregularity disables far more than the offending row.

## Solution

Make the schema exactly as strict as the reader — no stricter:

- Tolerate `null`/absent on fields the code does **not** read: `field: z.number().nullish()`.
- For numeric fields the code reads and expects a number, coerce `null`/`undefined` to the prior default instead of `.default()`:
  ```ts
  // BEFORE — rejects null
  value: z.number().optional().default(0),
  // AFTER — replicates the old `value || 0`
  value: z.number().nullish().transform((v) => v ?? 0),
  ```
- For fields that may receive a wrong-typed **present** value (e.g. `"N/A"` where a number is expected), use a per-field defanging helper instead of `.optional()` or `.default()`:
  ```ts
  // A numeric field that must never reject the parent object.
  // Accepts number, string-that-looks-like-a-number, null, undefined, or garbage like "N/A".
  // Returns the numeric value when parseable, otherwise undefined (which downstream treats as absence).
  const offNumericField = z
    .unknown()
    .catch(undefined)
    .transform((v) => {
      const n = parseFloat(String(v));
      return Number.isFinite(n) ? n : undefined;
    });
  ```
  Then use it on each numeric nutriment key:
  ```ts
  const offNutrimentsSchema = z.object({
    energy_kcal_100g: offNumericField,
    sugars_100g: offNumericField,
    // ... etc
  }).passthrough().catch(() => ({}));
  ```
  The `.passthrough().catch(() => ({}))` on the enclosing object ensures that an unrecognized or malformed key within the nutriments object never drops the whole group — one garbage field stays isolated.
- **Crucially: do NOT use `z.coerce.number()` here.** Coercion turns `null` → `0`, poisoning the cache with false zeros. Open Food Facts returns `null` for genuinely unreported nutrients; coercing to `0` would make every missing value look like "this food has zero sugars," which is wrong and monetized. The safe direction for a monetized cache is **drop-not-coerce**.
- Keep strict typing only on the fields actually consumed (`nutrient_web_name`, `nutrient_value`, `description`, `product_name`).
- When a TS interface annotates the parsed result, align the interface's optional/nullable-ness with the loosened schema so `z.infer` stays assignable (don't re-tighten via the annotation).

The conservative direction for a monetized/cached data path is still **drop bad values, don't write garbage** — but "drop" must mean "skip the one unusable value," not "reject the whole response."

## Prevention

- Before writing an ingestion-boundary schema, list the fields the consumer reads. Everything else is `.nullish()` / `.passthrough()`.
- Remember `.default(x)` fires on `undefined` only; for `null`-tolerant defaults use `.nullish().transform((v) => v ?? x)` (or `z.preprocess`).
- Remember `.optional()` tolerates only `undefined`/absent — **not** wrong-typed present values. When an upstream API may return a string like `"N/A"` where the consumer expects a number, use `z.unknown().catch(undefined).transform(...)` to defang the field before it reaches the number check.
- Never use `z.coerce.number()` for ingestion from untrusted APIs — it poisons `null`/`"N/A"`/empty strings to `0`, creating false data that the cache treats as authoritative.
- Prefer per-item lenient parse + filter over whole-array `safeParse` when one bad element shouldn't disable the batch.
- A validation fix is not done until you've confirmed it does not reject inputs the old code accepted — a too-strict guard is a silent failure wearing a safety vest.

## Related Files

- `server/services/nutrition-lookup.ts` — `cnfFoodListSchema`, `cnfNutrientAmountListSchema`, `usdaFoodSchema`/`usdaUpcResponseSchema`, `offNutrimentsSchema` (added 2026-05-30)
- Caught by the Phase 6 code-reviewer in the 2026-05-29 reliability audit (the per-fix kimi-review passed it).

## See Also

- `docs/solutions/runtime-errors/unsafe-type-cast-zod-validation.md` — the inverse lesson (validate instead of `as`); this file is the "don't over-correct" counterweight.
