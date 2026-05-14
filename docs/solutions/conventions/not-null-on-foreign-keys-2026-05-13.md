---
title: "NOT NULL on foreign keys"
track: knowledge
category: conventions
tags: [database, schema, foreign-keys, drizzle, integrity]
module: shared
applies_to: ["shared/schema.ts"]
created: 2026-05-13
---

# NOT NULL on foreign keys

## Rule

Always mark foreign key columns as NOT NULL unless nulls are explicitly needed.

## Examples

```typescript
export const dailyLogs = pgTable("daily_logs", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id")
    .references(() => users.id, { onDelete: "cascade" })
    .notNull(), // NOT NULL - every log must have a user
  scannedItemId: integer("scanned_item_id")
    .references(() => scannedItems.id, { onDelete: "cascade" })
    .notNull(), // NOT NULL - every log must reference an item
  // ...
});
```

## Why

Prevents orphaned records and enforces referential integrity at the database level.

## Exceptions

Genuinely nullable foreign keys (e.g., `dailyLogs` can reference EITHER `scannedItems` OR `mealPlanRecipes` — both columns are nullable but a CHECK constraint enforces at least one must be set). See the CHECK constraint pattern for that case.

## Related Files

- `docs/rules/database.md` — binding rule: polymorphic FK always requires a discriminator column

## See Also

- [CHECK constraint for mutually-optional FK pairs](check-constraint-mutually-optional-fk-pairs-2026-05-13.md)
- [Indexes for foreign keys and sort columns](indexes-for-foreign-keys-and-sort-columns-2026-05-13.md)
