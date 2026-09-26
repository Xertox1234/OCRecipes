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
sorting (or scanning) every row that matches the equality filter. Add `DESC` to any sort
column whose `ORDER BY` clause is descending. A tiebreak column (e.g. a serial `id`)
belongs in the index too, in the same direction, so ties resolve without an extra sort.

**A descending index column must be `.desc().nullsFirst()`, not bare `.desc()`.** The
index column's `NULLS` placement has to match the query's, and the Drizzle defaults don't
match each other:

- The query-builder helper `desc(col)` emits a bare `col desc`, which Postgres reads as
  `DESC NULLS FIRST`.
- The index builder defaults **every** column to `NULLS LAST`, so `.desc()` in an
  `index().on(...)` produces `DESC NULLS LAST`.

The planner matches `NULLS` placement **syntactically**, and `NOT NULL` columns do not
relax it. So a `DESC NULLS LAST` index serves only the equality filter, and the query still
gets a `Sort` node. #1103 first shipped exactly this, with an "after" EXPLAIN that did not
reproduce with the app's literal `ORDER BY` (independent review, 2026-09-26). To verify,
EXPLAIN the query **exactly as the app emits it** (copy its `ORDER BY` clause literally),
and confirm there is no `Sort` node.

When a **hand-written migration file** mirrors a Drizzle-declared index, copy the DDL from
`pg_indexes.indexdef` on a dev DB the schema was `db:push`'d onto, rather than transcribing
`schema.ts` by hand. Postgres omits the default `NULLS` clause from `indexdef`: a
`DESC NULLS FIRST` column shows as plain `DESC`.

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
  table.createdAt.desc().nullsFirst(),
  table.id.desc().nullsFirst(),
),
```

which `db:push` applies as `btree (conversation_id, created_at DESC, id DESC)`. Verified
with `EXPLAIN (ANALYZE, BUFFERS)` of a single-table query using the app's literal `ORDER BY`
(`ORDER BY created_at DESC, id DESC LIMIT 20`) on a seeded 350-row conversation. The
app's `chat_conversations` join and its default limit were left out; an independent
join-inclusive EXPLAIN gave the same result:

- **No index, or the bare-`.desc()` NULLS LAST version:** a `Sort` (top-N heapsort) over
  a `Seq Scan`, reading 13 buffers.
- **The `.nullsFirst()` version:** an `Index Scan` on this index with no `Sort` node,
  stopping at the `LIMIT`, reading 4 buffers.

The hand-written prod migration (`migrations/0012_chat_messages_conv_created_id_idx.sql`)
spells out `DESC NULLS FIRST` explicitly.

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
  migration that spells out `DESC NULLS FIRST` to match the query's ordering
- `migrations/0009_users_email_lower_unique.sql` — the sibling "match Drizzle's output"
  concern for a functional index's constraint name

## See Also

- [Migrate prod schema before merging a column-adding PR](../best-practices/migrate-prod-schema-before-merge-railway-autodeploy-2026-06-18.md) — the deploy-ordering rule for the same class of hand-written prod migration
