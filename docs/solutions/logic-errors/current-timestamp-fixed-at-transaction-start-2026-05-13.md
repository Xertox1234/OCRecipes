---
title: CURRENT_TIMESTAMP is fixed at transaction start — sequential inserts tie
track: bug
category: logic-errors
module: server
severity: medium
tags: [postgres, transactions, timestamps, drizzle, test-isolation]
symptoms: [ORDER BY created_at DESC returns rows in arbitrary order in tests, Two rows inserted with await sleep(50ms) between them get identical createdAt, Test passes when run individually but fails in suite due to shared transaction]
applies_to: [server/storage/**/__tests__/**/*.ts, test/**/*.ts]
created: '2026-05-10'
---

# CURRENT_TIMESTAMP is fixed at transaction start — sequential inserts tie

## Problem

Within a single PostgreSQL transaction, `CURRENT_TIMESTAMP` (and `now()`) returns the time the transaction started — not the time of each statement. Drizzle's `.default(sql\`CURRENT_TIMESTAMP\`)`therefore stamps every row inserted in the same transaction with the same`createdAt`. When a test does `INSERT A; await sleep(50ms); INSERT B`inside a single`setupTestTransaction`, A and B end up with identical `createdAt`values and`ORDER BY created_at DESC` returns them in arbitrary (insertion-order or row-id) order.

## Symptoms

- Tests asserting order-by-timestamp fail intermittently or always return the wrong order
- Two rows logged at different wall-clock times have the same database timestamp
- Behaviour only reproduces in transaction-wrapped test suites

## Root Cause

PostgreSQL's `CURRENT_TIMESTAMP` and `now()` are _transaction-start_ timestamps by SQL spec — they intentionally return a single stable value for the lifetime of the transaction so all statements in a logical unit share a consistent "now". `await sleep()` between statements changes wall-clock time but not transaction time.

## Solution

Explicitly pass `createdAt: new Date(baseTime - 60_000)` for the older row when ordering matters:

```typescript
const baseTime = Date.now();
const older = await createRecipe({ createdAt: new Date(baseTime - 60_000) });
const newer = await createRecipe({ createdAt: new Date(baseTime) });
```

If you actually need wall-clock-distinct timestamps inside production code, use `statement_timestamp()` (changes per statement) or `clock_timestamp()` (changes per call) instead of `CURRENT_TIMESTAMP`. For test code, explicit dates are simpler and deterministic.

## Prevention

When transaction-wrapped tests depend on chronological ordering, never rely on column defaults — pass explicit `createdAt` values. Add this to the testing checklist whenever a new ordered-by-time query is introduced.

## Related Files

- `server/storage/__tests__/carousel.test.ts`
- `test/db-test-utils.ts` — transaction-based test isolation

## See Also

- [Storage integration tests with transaction rollback](../design-patterns/storage-integration-tests-transaction-rollback-2026-05-13.md)
- [Timestamp without tz roundtrip real db tests](../design-patterns/timestamp-without-tz-roundtrip-real-db-tests-2026-05-13.md)
