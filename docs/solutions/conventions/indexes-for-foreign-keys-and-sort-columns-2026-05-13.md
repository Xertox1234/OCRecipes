---
title: "Indexes for foreign keys and sort columns"
track: knowledge
category: conventions
tags: [database, schema, indexes, drizzle, performance]
module: shared
applies_to: ["shared/schema.ts"]
created: 2026-05-13
---

# Indexes for foreign keys and sort columns

## Rule

Add indexes to columns used in WHERE clauses and ORDER BY.

## Examples

```typescript
export const scannedItems = pgTable(
  "scanned_items",
  {
    id: serial("id").primaryKey(),
    userId: varchar("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    productName: text("product_name").notNull(),
    scannedAt: timestamp("scanned_at")
      .default(sql`CURRENT_TIMESTAMP`)
      .notNull(),
    // ... other columns
  },
  (table) => ({
    userIdIdx: index("scanned_items_user_id_idx").on(table.userId),
    scannedAtIdx: index("scanned_items_scanned_at_idx").on(table.scannedAt),
  }),
);
```

## Why

- `userId` index: Fast filtering by user (every query filters by user)
- `scannedAt` index: Fast sorting for history screen (`ORDER BY scannedAt DESC`)

## Related Files

- `shared/schema.ts` — index declarations on every domain table
