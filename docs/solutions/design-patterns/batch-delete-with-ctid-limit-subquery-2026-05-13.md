---
title: Batch DELETE with ctid + LIMIT subquery
track: knowledge
category: design-patterns
module: server
tags: [database, postgres, sql, batch-delete, retention, ctid]
applies_to: [server/scripts/**/*.ts]
created: '2026-05-13'
---

# Batch DELETE with ctid + LIMIT subquery

## When this applies

PostgreSQL does **not** support `LIMIT` on `DELETE`. To delete in bounded batches (avoiding long-running transactions and lock contention), select `ctid` (the row's physical tuple address) from a LIMITed subquery and delete by ctid.

## Examples

```typescript
const result = await db.execute(sql`
  DELETE FROM ${tableId}
  WHERE ctid IN (
    SELECT ctid FROM ${tableId}
    WHERE ${timeId} < ${cutoff}
    LIMIT ${batchSize}
  )
`);
const rowCount = (result as { rowCount?: number | null }).rowCount ?? 0;
```

Loop until `rowCount < batchSize`. The ctid value uniquely identifies a tuple within a single statement, so the inner SELECT and outer DELETE are race-safe.

## When to use

Background retention/cleanup jobs (`scanned_items`, `daily_logs`, audit log purges) that may delete tens of thousands of rows per night.

## Related Files

- `server/scripts/cleanup-retention.ts::purgeBatch`

## See Also

- [Avoid parameter-limit overflow in NOT IN lists](avoid-parameter-limit-overflow-not-in-lists-2026-05-13.md)
- [Cascade-aware retention ordering](../conventions/cascade-aware-retention-ordering-2026-05-13.md)
