---
title: "Upsert with onConflictDoUpdate"
track: knowledge
category: design-patterns
tags: [database, drizzle, upsert, on-conflict, unique-constraints]
module: server
applies_to:
  ["server/storage/**/*.ts", "server/routes/**/*.ts", "shared/schema.ts"]
created: 2026-05-13
---

# Upsert with onConflictDoUpdate

## When this applies

When a resource should have exactly one row per user (or per unique key) and the client sends either a "create" or "update" without knowing which, use Drizzle's `onConflictDoUpdate` to atomically insert-or-update in a single query.

## Examples

```typescript
// server/routes/fasting.ts — one schedule per user
const [result] = await db
  .insert(fastingSchedules)
  .values({ userId: req.userId!, ...parsed.data })
  .onConflictDoUpdate({
    target: [fastingSchedules.userId], // unique constraint column(s)
    set: parsed.data, // columns to update on conflict
  })
  .returning();
res.json(result);
```

```typescript
// server/storage.ts — one HealthKit sync setting per (userId, dataType)
const [result] = await db
  .insert(healthKitSync)
  .values({ userId, dataType, enabled, syncDirection })
  .onConflictDoUpdate({
    target: [healthKitSync.userId, healthKitSync.dataType],
    set: { enabled, ...(syncDirection ? { syncDirection } : {}) },
  })
  .returning();
```

## When to use

- User settings or preferences with a unique constraint per user (fasting schedule, sync settings, notification preferences)
- Cache tables where the cache key is unique and stale entries should be overwritten
- Any "save" endpoint where the client does not distinguish between create and update

## Exceptions

- Resources where multiple rows per user are expected (logs, messages, items)
- Cases where you need to know whether the operation was an insert or update (use a transaction with explicit check instead)

## Key elements

1. **`target` must match the unique constraint** — Drizzle generates `ON CONFLICT (col1, col2) DO UPDATE SET ...`
2. **`set` specifies only the columns to update** — do not include the conflict target columns in `set`
3. **`.returning()`** — returns the final row regardless of whether it was inserted or updated
4. **No transaction needed** — the upsert is atomic at the SQL level

**Schema prerequisite:** The target columns must have a unique constraint:

```typescript
export const fastingSchedules = pgTable("fasting_schedules", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id")
    .references(() => users.id)
    .notNull()
    .unique(), // unique per user
  // ...
});
```

## Related Files

- `server/routes/fasting.ts` — `PUT /api/fasting/schedule`
- `server/storage.ts` — `upsertHealthKitSyncSetting()`
- `server/services/nutrition-lookup.ts` — nutrition cache upsert

## See Also

- [Unique index + onConflictDoUpdate for AI cache dedup](unique-index-onconflictdoupdate-ai-cache-dedup-2026-05-13.md)
- [Functional (expression) unique index + raw SQL upsert](functional-expression-unique-index-raw-sql-upsert-2026-05-13.md)
- [Defensive cache writes with onConflictDoNothing](../conventions/defensive-cache-writes-onconflictdonothing-2026-05-13.md)
