---
title: Pagination count must match list query filters
track: knowledge
category: conventions
module: server
tags: [database, drizzle, pagination, routes, sql]
applies_to: [server/routes/**/*.ts, server/storage/**/*.ts]
created: '2026-05-13'
---

# Pagination count must match list query filters

## Rule

When a paginated endpoint returns both `items` and `total`, the count query must apply the same WHERE conditions as the list query. A mismatch causes the client to show incorrect page counts or request pages that return empty.

## Examples

```typescript
// ✅ GOOD: Count and list share the same filter conditions
const conditions = [eq(flags.barcode, barcode)];
if (status) {
  conditions.push(eq(flags.status, status));
}
const where = and(...conditions);

const [items, [{ count }]] = await Promise.all([
  db.select().from(flags).where(where).limit(limit).offset(offset),
  db
    .select({ count: sql<number>`count(*)` })
    .from(flags)
    .where(where),
]);

res.json({ items, total: Number(count), page, limit });
```

```typescript
// ❌ BAD: Count ignores the status filter
const items = await db
  .select()
  .from(flags)
  .where(and(eq(flags.barcode, barcode), eq(flags.status, status)))
  .limit(limit)
  .offset(offset);

// Count query doesn't include status filter — total is wrong
const [{ count }] = await db
  .select({ count: sql<number>`count(*)` })
  .from(flags)
  .where(eq(flags.barcode, barcode));

res.json({ items, total: Number(count), page, limit });
```

## When to use

Every paginated list endpoint that returns a `total` count alongside `items`.

## Why

Extract the shared `where` clause into a variable and pass it to both queries. This makes it impossible for the filters to diverge.

## Related Files

- `server/routes/verification.ts` — reformulation flag list endpoint
