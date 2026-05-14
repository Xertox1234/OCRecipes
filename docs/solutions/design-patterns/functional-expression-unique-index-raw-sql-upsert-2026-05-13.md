---
title: "Functional (expression) unique index + raw SQL upsert"
track: knowledge
category: design-patterns
tags: [database, drizzle, sql, unique-index, expression-index, upsert]
module: server
applies_to: ["server/storage/**/*.ts", "shared/schema.ts"]
created: 2026-05-13
---

# Functional (expression) unique index + raw SQL upsert

## When this applies

When a unique constraint is keyed on a SQL expression (e.g., `DATE(logged_at)`) rather than a bare column, Drizzle's typed `onConflictDoUpdate.target` array cannot reference it — it only accepts `PgColumn` values. Use `db.execute(sql\`...\`)`with a raw`ON CONFLICT` clause instead.

## Examples

```typescript
// shared/schema.ts — declare the functional unique index
export const weightLogs = pgTable(
  "weight_logs",
  {
    /* columns */
  },
  (table) => ({
    // One entry per user per calendar day
    userDateIdx: uniqueIndex("weight_logs_user_date_idx").on(
      table.userId,
      sql`DATE(${table.loggedAt})`,
    ),
  }),
);

// server/storage/health.ts — upsert via raw SQL (Drizzle cannot target expression indexes)
const result = await db.execute<WeightLog>(
  sql`INSERT INTO weight_logs (user_id, weight, unit, source, note)
      VALUES (${log.userId}, ${log.weight}, ${log.unit ?? "lb"}, ${log.source ?? "manual"}, ${log.note ?? null})
      ON CONFLICT (user_id, DATE(logged_at))
      DO UPDATE SET
        weight = EXCLUDED.weight,
        unit   = EXCLUDED.unit,
        source = EXCLUDED.source,
        note   = EXCLUDED.note
      RETURNING *`,
);
return result.rows[0] as WeightLog;
```

## Why

- Drizzle's `onConflictDoUpdate({ target: [...] })` resolves targets as column references. PostgreSQL expression indexes (`DATE(logged_at)`) are not column references, so Drizzle emits an incorrect `ON CONFLICT (logged_at)` clause that hits a non-existent unique constraint and throws at runtime.
- Using `db.execute(sql\`...\`)` passes the SQL through verbatim, letting PostgreSQL resolve the conflict against the correct expression index.
- The `logged_at` column is intentionally omitted from the `INSERT` column list so it defaults to `CURRENT_TIMESTAMP`, keeping the raw SQL in sync with the schema default.

## When to use

Any `ON CONFLICT` clause that must target a functional/partial unique index rather than a set of plain columns.

## Related Files

- `shared/schema.ts` — `weight_logs_user_date_idx` uniqueIndex with `sql\`DATE(...)\``
- `server/storage/health.ts` — `createWeightLog` and `createWeightLogAndUpdateUser`
- M9 finding from the 2026-04-26 schema/data-integrity audit

## See Also

- [Upsert with onConflictDoUpdate](upsert-with-onconflictdoupdate-2026-05-13.md)
