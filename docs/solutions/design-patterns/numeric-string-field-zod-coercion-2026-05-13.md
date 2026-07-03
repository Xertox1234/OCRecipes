---
title: numericStringField / nullableNumericStringField for Zod numeric string coercion
track: knowledge
category: design-patterns
module: server
tags: [api, zod, validation, multipart, helper]
applies_to: [server/routes/**/*.ts]
created: '2026-05-13'
---

# numericStringField / nullableNumericStringField for Zod numeric string coercion

## When this applies

Route body schemas for nutrition values, quantities, measurements — any numeric field that arrives as a string from `multipart/form-data`. Replaces the 15+ inline repetitions of `z.union([z.string(), z.number()]).optional().transform(...)`.

## Why

`multipart/form-data` always serializes numbers as strings, so route schemas for upload endpoints need to accept either type. Inlining the union/transform pair drifts across files — one route uses `.optional()`, another forgets the `.nullable()`, a third stringifies differently. The shared helpers lock the shape.

## Examples

```typescript
import { numericStringField, nullableNumericStringField } from "./_helpers";

// Good: reusable helpers
const ItemSchema = z.object({
  calories: numericStringField, // string | number → string | undefined
  fat: nullableNumericStringField, // string | number → string | null
  protein: numericStringField,
});

// Bad: 15 repetitions of the same union transform
const ItemSchema = z.object({
  calories: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => v?.toString()),
  fat: z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((v) => v?.toString() ?? null),
  // ...repeated for every numeric field
});
```

Implementation:

```typescript
// server/routes/_helpers.ts

/** Accepts string or number, coerces to string. Returns undefined if absent. */
export const numericStringField = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => v?.toString());

/** Accepts string or number, coerces to string. Returns null if absent. */
export const nullableNumericStringField = z
  .union([z.string(), z.number()])
  .optional()
  .nullable()
  .transform((v) => v?.toString() ?? null);
```

## When to use

- Use `numericStringField` when the field is fully optional and absent means "not provided"
- Use `nullableNumericStringField` when absent or null should be stored as `null` in the DB

## Exceptions

- Fields that must be validated as actual numbers → `z.number()`
- Fields that are always strings → `z.string()`

## Related Files

- `server/routes/_helpers.ts` — implementation
- `server/routes/nutrition.ts` (7x), `meal-plan.ts` (6x), `pantry.ts`, `grocery.ts` — consumers

## See Also

- [Input validation with Zod](../conventions/input-validation-with-zod-2026-05-13.md)
