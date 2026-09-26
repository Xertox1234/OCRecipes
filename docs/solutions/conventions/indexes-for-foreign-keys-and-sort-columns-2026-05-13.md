---
title: Indexes for foreign keys and sort columns
track: knowledge
category: conventions
module: shared
tags: [database, schema, indexes, drizzle, performance]
applies_to: [shared/schema.ts, migrations/*.sql]
created: '2026-05-13'
last_updated: '2026-09-26'
---

# Indexes for foreign keys and sort columns

## Rule

Add indexes to columns used in WHERE clauses and ORDER BY. When a query filters by an
equality column and then orders by one or more other columns, a single composite index
`(equalityCol, sortCol1 [DESC], sortCol2 [DESC], ...)` lets Postgres serve the whole
query — filter, order, and `LIMIT` — with one `Index Scan` and no `Sort` node, instead of
sorting (or scanning) every row that matches the equality filter. Add `DESC` (via
`.desc()` on the column, inside `.on(...)`) to any sort column whose `ORDER BY` clause is
descending; a tiebreak column (e.g. a serial `id`) belongs in the index too, in the same
direction as its `ORDER BY` clause, so ties resolve without an extra sort step.

When a **hand-written migration file** mirrors a Drizzle-declared index that uses
`.desc()`, don't hand-transcribe the column list from `schema.ts` — copy the DDL from
`pg_indexes.indexdef` (or `pg_get_indexdef()`) on a dev DB the schema was actually
`db:push`'d onto, and diff the two. Drizzle's `.desc()` compiles to an explicit
`DESC NULLS LAST`, while Postgres's own `CREATE INDEX ... DESC` (with no `NULLS` clause)
defaults to `NULLS FIRST` — so a migration written by hand from the schema source, rather
than from the actual applied DDL, silently produces a **different** index than the one
`db:push` creates in dev/CI. It's harmless only as long as every indexed column stays
`NOT NULL` (verify this explicitly, don't assume it) — the two orderings diverge the
moment a NULL can appear.

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

A composite covering index for an equality filter + descending order + tiebreak, from
`chat_messages` (`getChatMessages` does
`WHERE conversationId = ? ORDER BY createdAt DESC, id DESC LIMIT n`):

```typescript
index("chat_messages_conv_created_id_idx").on(
  table.conversationId,
  table.createdAt.desc(),
  table.id.desc(),
),
```

which `db:push` applies as
`btree (conversation_id, created_at DESC NULLS LAST, id DESC NULLS LAST)` — verified via
`EXPLAIN (ANALYZE, BUFFERS)`: before the index, `Sort` (top-N heapsort) over a `Seq Scan`
of the conversation's rows; after, an `Index Scan` on this index with no `Sort` node, that
stops at the `LIMIT`. The corresponding hand-written prod migration
(`migrations/0012_chat_messages_conv_created_id_idx.sql`) spells out `NULLS LAST`
explicitly for exactly the reason in the Rule above, rather than writing
`created_at DESC, id DESC` and relying on Postgres's default matching Drizzle's.

## Why

- `userId` index: Fast filtering by user (every query filters by user)
- `scannedAt` index: Fast sorting for history screen (`ORDER BY scannedAt DESC`)
- A composite `(equality, sort DESC, tiebreak DESC)` index turns a per-request `Sort` over
  every row matching the equality filter into an `Index Scan` that stops at `LIMIT` —
  the difference grows with conversation/list length, and every layer above (coach
  context, chat history, warm-up) pays the same query on every turn.
- Byte-matching a hand-written migration to the actual `db:push`'d DDL (not to the
  Drizzle source) catches null-ordering drift before it reaches production, where it
  would otherwise surface only once a NULL is possible in an indexed column.

## Related Files

- `shared/schema.ts` — index declarations on every domain table
- `shared/schema.ts` (`chatMessages` table) — the composite covering index example above
- `migrations/0012_chat_messages_conv_created_id_idx.sql` — the hand-written prod
  migration that spells out `NULLS LAST` to match `db:push`'s actual output
- `migrations/0009_users_email_lower_unique.sql` — the sibling "match Drizzle's output"
  concern for a functional index's constraint name

## See Also

- [Migrate prod schema before merging a column-adding PR](../best-practices/migrate-prod-schema-before-merge-railway-autodeploy-2026-06-18.md) — the deploy-ordering rule for the same class of hand-written prod migration
