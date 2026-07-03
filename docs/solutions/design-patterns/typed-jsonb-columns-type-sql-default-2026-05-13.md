---
title: Typed JSONB columns with .$type<>() and sql default
track: knowledge
category: design-patterns
module: shared
tags: [database, jsonb, drizzle, typescript, schema, defaults]
applies_to: [shared/schema.ts, shared/types/**/*.ts]
created: '2026-05-13'
---

# Typed JSONB columns with .$type<>() and sql default

## When this applies

When a JSONB column stores a known TypeScript type, use `.$type<T>()` to teach Drizzle the TypeScript shape, and use `sql\`'{}'::jsonb\``(not`.default({})`) for the empty-object default. A JavaScript `{}` default is serialized differently by Drizzle and can cause migration drift in PostgreSQL.

## Examples

```typescript
// shared/schema.ts
import type { ReminderMutes } from "./types/reminders";

export const userProfiles = pgTable("user_profiles", {
  // Good: .$type<> for TS shape, sql literal for the PG default
  reminderMutes: jsonb("reminder_mutes")
    .$type<ReminderMutes>()
    .default(sql`'{}'::jsonb`)
    .notNull(),

  // Bad: JS object default — Drizzle may serialize this differently
  // reminderMutes: jsonb("reminder_mutes").default({}).notNull(),
});

// For JSONB columns that hold a known-shape context object:
context: jsonb("context")
  .$type<Record<string, unknown>>()
  .notNull()
  .default(sql`'{}'::jsonb`),
```

## Why sql`'{}'::jsonb` instead of .default({})

Drizzle passes JS object defaults through `JSON.stringify`, which produces `'{}'` as text. PostgreSQL then casts it to `jsonb`. The `sql` template passes the literal `'{}'::jsonb` directly, which is unambiguous and matches what `db:push` generates. The difference is invisible at runtime but shows up as a spurious migration diff if you later introspect the schema.

## .$type<T>() scope

This annotation is TypeScript-only — Drizzle does not validate JSONB contents at insert time. Any JSONB column must still be validated at read time if the shape can't be guaranteed (see [Zod safeParse per JSONB element](../conventions/zod-safeparse-per-jsonb-element-2026-05-13.md) and [Safe JSONB array access with Array.isArray guard](../conventions/safe-jsonb-array-access-isarray-guard-2026-05-13.md)).

## When to use

Any `jsonb()` column with a fixed TypeScript shape — settings objects, context payloads, typed metadata. For truly open-ended JSONB (arbitrary JSON from external sources), use `.$type<Record<string, unknown>>()` or leave untyped.

## Related Files

- `shared/schema.ts` — `userProfiles.reminderMutes`, `pendingReminders.context`
- `shared/types/reminders.ts` — `ReminderMutes` type used by `.$type<>()`

## See Also

- [JSONB metadata versioning](jsonb-metadata-versioning-2026-05-13.md)
- [Zod safeParse per JSONB element](../conventions/zod-safeparse-per-jsonb-element-2026-05-13.md)
