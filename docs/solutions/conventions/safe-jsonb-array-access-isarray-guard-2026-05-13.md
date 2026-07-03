---
title: Safe JSONB array access with Array.isArray guard
track: knowledge
category: conventions
module: server
tags: [database, jsonb, type-safety, drizzle, runtime-validation]
applies_to: [server/storage/**/*.ts, server/services/**/*.ts]
created: '2026-05-13'
---

# Safe JSONB array access with Array.isArray guard

## Rule

JSONB columns in PostgreSQL can contain any JSON value. When the application expects an array, always guard with `Array.isArray()` before iterating. Drizzle ORM types JSONB columns as `unknown`, so TypeScript provides no protection against non-array values.

## Examples

```typescript
// Good: Guard before iterating JSONB data
const effects = log.sideEffects; // JSONB column — could be null, object, string, array, etc.
if (Array.isArray(effects)) {
  for (const effect of effects) {
    if (typeof effect === "string") {
      sideEffectCounts.set(effect, (sideEffectCounts.get(effect) || 0) + 1);
    }
  }
}
```

```typescript
// Bad: Assume JSONB column is an array
const effects = log.sideEffects as string[]; // Could be null, an object, or a bare string
for (const effect of effects) {
  // TypeError: effects is not iterable
  sideEffectCounts.set(effect, (sideEffectCounts.get(effect) || 0) + 1);
}
```

## Why

- JSONB columns can be `null`, `{}`, `"string"`, `42`, or `[]` — all valid JSON values
- `as string[]` is a compile-time-only assertion that provides zero runtime safety
- Database values may have been written by a different version of the code with a different schema
- Manual database edits or migrations can leave unexpected shapes in JSONB columns

**Two levels of defense:**

1. `Array.isArray(value)` — confirms the value is actually an array
2. `typeof element === "string"` (or similar) — validates each element's type

## When to use

Every time you read a JSONB column and iterate over its contents. This applies to arrays of strings, arrays of objects, or any nested structure.

## Exceptions

When the JSONB value has already been validated by Zod `safeParse()` earlier in the request lifecycle.

## Related Files

- `server/services/glp1-insights.ts` — `sideEffects` JSONB column. Also applies to `allergies`, `foodDislikes`, and other JSONB array columns in `userProfiles`

## See Also

- [Zod safeParse per JSONB element](zod-safeparse-per-jsonb-element-2026-05-13.md)
- [JSONB array length filtering in queries](jsonb-array-length-filtering-coalesce-2026-05-13.md)
- [Unsafe Type Cast — Use Zod Validation Instead](../runtime-errors/unsafe-type-cast-zod-validation.md)
