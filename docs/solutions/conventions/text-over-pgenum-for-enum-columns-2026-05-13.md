---
title: Prefer text() over pgEnum for enum-like columns
track: knowledge
category: conventions
module: shared
tags: [database, drizzle, schema, enum, validation, zod]
applies_to: [shared/schema.ts, server/storage/**/*.ts]
created: '2026-05-13'
---

# Prefer text() over pgEnum for enum-like columns

## Rule

Use `text()` with application-level validation (Zod) instead of `pgEnum` for columns with a fixed set of values (status, type, tier, platform, role).

## Examples

```typescript
// Good: text() with Zod validation at the application boundary
export const transactions = pgTable("transactions", {
  status: text("status").default("pending").notNull(),
  platform: text("platform").notNull(),
});

// Validate at API boundary with Zod
const PlatformSchema = z.enum(["ios", "android"]);
const StatusSchema = z.enum(["pending", "approved", "rejected"]);

// Validate from database with safeParse + fallback
const tier = subscriptionTierSchema.safeParse(row.subscriptionTier);
return tier.success ? tier.data : "free";
```

```typescript
// Avoid: pgEnum creates a database-level type requiring migrations to change
import { pgEnum } from "drizzle-orm/pg-core";

const statusEnum = pgEnum("transaction_status", [
  "pending",
  "approved",
  "rejected",
]);
export const transactions = pgTable("transactions", {
  status: statusEnum("status").default("pending").notNull(),
});
// Adding "refunded" later requires ALTER TYPE ... ADD VALUE migration
```

## Why

- Adding/removing values requires a database migration with `pgEnum` but only a code change with `text()`
- Drizzle ORM push (`npm run db:push`) handles `text()` columns cleanly; `pgEnum` changes can cause push conflicts
- Validation belongs at the application boundary (Zod schemas), not the database layer
- All existing tables in this project use `text()` for enum-like fields (`subscriptionTier`, `sourceType`, `status`, `platform`, `mealType`, `category`)

## Exceptions

When the value set is truly fixed for the lifetime of the database and you need PostgreSQL-level enforcement (e.g., extension-defined types). For typical product enums, prefer `text()`.

## Related Files

- `shared/schema.ts` — every enum-like column uses `text()`

## See Also

- [Unsafe Type Cast — Use Zod Validation Instead](../runtime-errors/unsafe-type-cast-zod-validation.md)
- [Input validation with Zod](../conventions/input-validation-with-zod-2026-05-13.md)
