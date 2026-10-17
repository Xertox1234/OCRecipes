---
title: "Promise.all over two or more queries on one transaction client runs them on a single pg connection — pg 8 queues them and warns, pg@9 removes the queue; await them in turn"
track: bug
category: logic-errors
tags: [database, drizzle, transactions, pg, testing]
module: server
applies_to: ["server/storage/**/*.ts", "server/storage/__tests__/**/*.ts"]
symptoms: ["DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0", "A db.transaction callback wraps several tx.* queries in one Promise.all", "The warning appears once per process, on a path that fans three or more queries out on one tx"]
created: 2026-10-17
severity: low
---

# Promise.all over two or more queries on one transaction client shares a single connection

## Problem

Four storage functions wrapped two or more queries on the same transaction
client (`tx`) in `Promise.all`: `disableMfa` (4 deletes),
`deleteMealPlanRecipe` (3), `deleteCommunityRecipe` (4) and
`countRecipeGenerationsToday` (two counts plus a helper that takes `tx`).
The code worked, because `pg` queues a query issued while another is in
flight on the same client. The manual MFA reset on production printed the
deprecation above; pg@9 removes that queue, so the same shape would stop
working after the upgrade.

## Symptoms

- `DeprecationWarning: Calling client.query() when the client is already executing a query is deprecated and will be removed in pg@9.0.` on a server or script run.
- A `db.transaction(async (tx) => …)` body with `Promise.all([tx…, tx…])`, or `Promise.all([tx…, helper(tx, …)])`.
- The warning is one-shot per process (`util.deprecate`) and only fires from the **third** concurrent query on one client (measured against installed pg 8.21.0: queue length is checked after the first query has already been shifted out). A two-element `Promise.all` on one `tx` is silent today and still removed in pg@9.

## Root Cause

A Drizzle `db.transaction` checks out ONE pool client and runs every `tx.*`
query on it (`drizzle-orm/node-postgres/session.js`). Postgres runs one
statement at a time per connection, so `Promise.all` buys no parallelism;
it only asks `pg` to queue. The project rule in `docs/rules/database.md`
used to say the opposite ("inside transactions run parallel queries with
`Promise.all`"), which is how four sites acquired the shape.

## Solution

Plain sequential `await`s, same statements, same order (pg ran the queued
array FIFO, so the wire order is unchanged):

```ts
await tx.delete(userMfa).where(eq(userMfa.userId, userId));
await tx.delete(mfaChallenges).where(eq(mfaChallenges.userId, userId));
```

A destructured `Promise.all` becomes three `const … = await` lines; keep
the final arithmetic as it was. A `db` (pool) read may stay in a
`Promise.all` beside a single `tx` query — they use different connections
(`server/storage/favourite-recipes.ts`).

**Test that pins it (no Postgres needed).** Mock `../../db` with a fake
`db.transaction` whose `tx` is a chainable Proxy: every method returns
another link; awaiting a link (its `then`) is "the query runs". Count how
many links are awaited at once, resolve each on `setTimeout(…, 0)` so
queries started together are measured together, and assert the maximum is
1 for each function. Include a positive control: `Promise.all` over two
`fakeTx.delete(t).where(c)` builders must read 2, or a 1 proves nothing.
See `server/storage/__tests__/tx-sequential-queries.test.ts`.

## Prevention

- Rule: `docs/rules/database.md` — "On one transaction client (`tx`), `await` queries one after another … `Promise.all` only across pool `db` reads."
- Re-check, any array position, across `server/**/*.ts` outside tests: find each `Promise.all|allSettled|race|any([` … `])`, split the array on top-level commas, and flag arrays with two or more elements containing `\btx\b`. A single-line `grep 'tx\.'` misses every multi-line builder (it found 1 of 4 sites on 2026-10-12); the first multi-line scan only matched a `tx` **first** element.
- A helper that receives `tx` (`countClaimsToday(tx, …)`) is a `tx` query too.

## Related Files

- `server/storage/mfa.ts` — `disableMfa`
- `server/storage/meal-plan-recipes-crud.ts` — `deleteMealPlanRecipe`
- `server/storage/community-recipes.ts` — `deleteCommunityRecipe`
- `server/storage/chat-quota.ts` — `countRecipeGenerationsToday`
- `server/storage/favourite-recipes.ts` — the compliant one-`tx`-plus-one-`db` shape
- `server/storage/__tests__/tx-sequential-queries.test.ts` — the in-flight gauge test
- `docs/rules/database.md` — the narrowed rule

## See Also

- [Side effects inside db.transaction desync on rollback](side-effects-inside-db-transaction-rollback-2026-05-13.md) — what else must stay out of, or in, the transaction body
- [Transaction-wrapped count-then-insert](../design-patterns/transaction-wrapped-count-then-insert-toctou-2026-05-13.md) — the count-inside-tx pattern `countRecipeGenerationsToday` follows
