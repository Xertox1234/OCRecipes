---
title: node-postgres pooled connection is poisoned when ROLLBACK is skipped on query error
track: bug
category: runtime-errors
module: server
severity: high
tags: [postgres, node-postgres, pg, transaction, connection-pool, rollback, resource-leak]
symptoms: ['Intermittent ''current transaction is aborted, commands ignored until end of transaction block''', 'Intermittent ''there is already a transaction in progress'' on a later, unrelated query', The first bad query in a tool works once; every subsequent call on the same long-lived server behaves wrong]
applies_to: [scripts/**/*.ts, server/**/*.ts]
created: '2026-06-13'
---

# node-postgres pooled connection is poisoned when ROLLBACK is skipped on query error

## Problem

A read-only `sql` tool acquired a pooled client, opened an explicit transaction, ran a user query, then committed/rolled back — but the `ROLLBACK` was placed **before** the `return`, inside the `try`:

```ts
// BUGGY:
const client = await pool.connect();
try {
  await client.query("BEGIN READ ONLY");
  const r = await client.query(query);   // <-- throws on syntax error / timeout / permission
  await client.query("ROLLBACK");        // <-- SKIPPED when the line above throws
  return text(r.rows);
} finally {
  client.release();                      // <-- still runs: returns the client MID-TRANSACTION to the pool
}
```

When `client.query(query)` throws, `ROLLBACK` is skipped but `finally` still calls `client.release()`. node-postgres returns the connection to the pool **with its `BEGIN READ ONLY` transaction still open**. The next caller to borrow that pooled client inherits an open/aborted transaction, and their `BEGIN` (or first statement) throws — far from the original error site.

## Symptoms

- A failing query "poisons" a connection; the *next* unrelated query on a long-lived pool/server throws.
- Errors like "there is already a transaction in progress" or "current transaction is aborted".
- Reproducible only after at least one query error, so it survives happy-path tests.

## Root Cause

`finally` runs `release()` unconditionally, but the transaction cleanup (`ROLLBACK`) was in the `try` after the fallible statement. Releasing a client that is still inside a transaction hands a corrupted session back to the pool. The pool does not auto-rollback on release.

## Solution

Put `ROLLBACK` in `finally`, wrapped in its own try/catch (it is a no-op — and harmless to fail — when there is no active transaction):

```ts
const client = await pool.connect();
try {
  await client.query("BEGIN READ ONLY");
  const r = await client.query(query);
  return text(r.rows);
} finally {
  try {
    await client.query("ROLLBACK");
  } catch {
    /* no active transaction — ignore */
  }
  client.release();
}
```

## Prevention

Whenever you manually `BEGIN` on a pooled client, the matching `ROLLBACK`/`COMMIT` cleanup must live in `finally`, never on the success path only. Equivalent guard for read-only access: connect as a `SELECT`-only role so writes fail regardless (defense in depth), but that does NOT fix transaction-state leakage — the `finally` ROLLBACK is still required.

## Related Files

- `scripts/solutions-db/mcp-server.ts` — the `sql` tool's transaction block
- `scripts/solutions-db/lib/sql-guard.ts` — the read-only heuristic guard (orthogonal defense)

## See Also

- [../conventions/lazy-init-db-pool-and-api-client-in-test-imported-modules-2026-06-13.md](../conventions/lazy-init-db-pool-and-api-client-in-test-imported-modules-2026-06-13.md) — pool lifecycle (lazy construction for CI-safety)
