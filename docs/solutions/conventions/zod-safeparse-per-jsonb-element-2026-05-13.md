---
title: "Zod safeParse per JSONB element"
track: knowledge
category: conventions
tags: [database, jsonb, zod, validation, graceful-degradation, drizzle]
module: shared
applies_to:
  ["shared/**/*.ts", "server/storage/**/*.ts", "server/services/**/*.ts"]
created: 2026-05-13
---

# Zod safeParse per JSONB element

## Rule

When a JSONB array column has a Zod schema for its element type, validate each element individually with `safeParse()` — skip invalid entries instead of failing the entire request. This is strictly more robust than an inline type guard approach because it recovers gracefully from partial corruption.

## Examples

```typescript
import { allergySchema } from "@shared/schema";
import type { AllergySeverity } from "@shared/constants/allergens";

/** Runtime-safe extraction of allergies from JSONB column. */
function parseAllergies(
  raw: unknown,
): { name: string; severity: AllergySeverity }[] {
  if (!Array.isArray(raw)) return [];
  const result: { name: string; severity: AllergySeverity }[] = [];
  for (const item of raw) {
    const parsed = allergySchema.safeParse(item);
    if (parsed.success) result.push(parsed.data);
    // Invalid entries silently skipped — partial corruption doesn't crash
  }
  return result;
}
```

```typescript
// Bad: as cast provides zero runtime safety
const allergies = profile.allergies as { name: string }[];

// Bad: crashes if any element is invalid
const allergies = allergyArraySchema.parse(profile.allergies);

// Good: per-element validation with graceful skip
const allergies = parseAllergies(profile.allergies);
```

## Why

JSONB columns can contain unexpected data from schema evolution, manual DB edits, or migration bugs. Per-element validation means a single corrupt entry doesn't prevent the other 8 valid allergies from being used. This was caught as a high-severity code review finding — the original `as` cast hid runtime type mismatches.

## When to use

JSONB array columns where a Zod schema exists for the element type and partial corruption should not fail the request (allergies, preferences, tags, side effects).

## Exceptions

- When the entire array must be valid-or-nothing (use full array schema validation).
- When no Zod schema exists for the element type (use `Array.isArray()` + inline guard).

## Related Files

- `shared/constants/allergens.ts` — `parseUserAllergies()` canonical shared implementation (used by 5+ files)
- `shared/schema.ts` — `allergySchema` Zod definition

## See Also

- [Safe JSONB array access with Array.isArray guard](safe-jsonb-array-access-isarray-guard-2026-05-13.md) (the type guard approach, suitable when no Zod schema exists)
- [Unsafe Type Cast — Use Zod Validation Instead](../runtime-errors/unsafe-type-cast-zod-validation.md)
