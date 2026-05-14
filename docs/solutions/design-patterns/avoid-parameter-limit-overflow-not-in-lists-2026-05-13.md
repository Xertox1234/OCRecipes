---
title: "Avoid parameter-limit overflow in NOT IN lists — use <> ALL($1::text[])"
track: knowledge
category: design-patterns
tags: [database, postgres, sql, drizzle, parameter-limit, scaling]
module: server
applies_to: ["server/scripts/**/*.ts", "server/storage/**/*.ts"]
created: 2026-05-13
---

# Avoid parameter-limit overflow in NOT IN lists — use <> ALL($1::text[])

## When this applies

A `NOT IN ($1, $2, ..., $n)` predicate with one bind per id can blow past PostgreSQL's ≈65k parameter limit once the exclusion list grows. Pass the list as a single SQL array parameter instead.

## Examples

```typescript
// BAD — one bind per id, may exceed pg parameter limit
sql`${userId} NOT IN (${sql.join(
  excludedIds.map((id) => sql`${id}`),
  sql`, `,
)})`;

// GOOD — single array parameter, scales to millions of ids
sql`${userId} <> ALL(${excludedIds}::text[])`;
```

The planner evaluates the membership test internally and a single bind covers any list size. For an empty exclusion list, emit a tautology (`TRUE`) rather than `<> ALL('{}')` — both are equivalent but the tautology keeps EXPLAIN plans cleaner.

## When to use

Anywhere the IN/NOT IN list size is data-driven and could exceed a few thousand entries (active-user exemption sets, blocked-id batches, etc.).

## Related Files

- `server/scripts/cleanup-retention.ts::purgeBatch`

## See Also

- [Batch DELETE with ctid + LIMIT subquery](batch-delete-with-ctid-limit-subquery-2026-05-13.md)
