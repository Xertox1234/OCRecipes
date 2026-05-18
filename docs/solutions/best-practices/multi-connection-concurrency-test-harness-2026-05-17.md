---
title: "Testing a multi-connection DB race needs a separate, un-mocked test file"
track: knowledge
category: best-practices
tags: [testing, vitest, database, postgres, race-condition, concurrency]
module: server
applies_to: ["server/storage/**/__tests__/*.test.ts"]
created: 2026-05-17
---

# Testing a multi-connection DB race needs a separate, un-mocked test file

## When this applies

You need to prove a storage function is safe (or unsafe) under genuine
concurrent transactions — e.g. a lost-update race where N requests verify the
same row at once. The standard storage-test harness **cannot** exercise this.

## Why

The standard harness (`test/db-test-utils.ts` + `vi.mock("../../db")`) is
single-connection by design:

- `vi.mock("../../db", () => ({ get db() { return getTestTx() } }))` is
  **module-scoped** — every call to the storage function in that test file
  routes through one transaction-scoped Drizzle instance on one connection.
- `setupTestTransaction()` opens a single outer transaction and uses
  savepoint isolation for rollback.

`Promise.all([fn(), fn()])` inside that harness _serializes_ on the single
connection — it never produces two concurrent transactions. It exercises
SQL-constraint behavior (e.g. `unique` + `onConflictDoNothing` idempotency)
but not a true race.

You cannot selectively bypass a module-scoped `vi.mock` for one `describe`
block. The fix is a **separate test file**.

## When this applies — the recipe

Create `server/storage/__tests__/<name>.concurrent.test.ts` that:

1. Does **not** `vi.mock("../../db")` and does **not** import
   `test/db-test-utils`. Import the real `db` from `../../db` — it is a
   connection pool, so parallel calls naturally check out distinct
   connections and run as genuine separate transactions.
2. Creates committed fixture rows (users, parent rows) via the real `db` so
   they are visible across all pooled connections.
3. Drives the race with `Promise.all` over N distinct actors hitting the same
   target row.
4. Asserts the post-condition invariant (e.g. `aggregateCount === COUNT(child
rows)`).
5. Cleans up in `afterAll` with explicit `DELETE` — there is no transaction
   rollback here. Rely on FK `ON DELETE CASCADE` to remove children when you
   delete the parent.

To prove the test actually catches the bug: temporarily remove the fix (e.g.
the advisory lock), run the file, confirm it FAILS, then restore the fix.

## Examples

```ts
// server/storage/__tests__/verification.concurrent.test.ts
import { db } from "../../db"; // real pool — NOT mocked
import { submitVerification } from "../verification";

describe("submitVerification — concurrent multi-connection safety", () => {
  const createdBarcodes: string[] = [];
  afterAll(async () => {
    for (const bc of createdBarcodes) {
      await db.delete(barcodeVerifications)
        .where(eq(barcodeVerifications.barcode, bc)); // cascade drops history
    }
  });

  it("does not lose-update under concurrent submits", async () => {
    const barcode = makeBarcode();
    createdBarcodes.push(barcode);
    const userIds = await Promise.all([/* 5 committed users */]);
    await Promise.all(
      userIds.map((uid) => submitVerification(barcode, uid, n, 0.95, true)),
    );
    const [agg] = await db.select(...).from(barcodeVerifications)
      .where(eq(barcodeVerifications.barcode, barcode));
    expect(agg.verificationCount).toBe(5); // < 5 without the lock
  });
});
```

## Related Files

- `server/storage/__tests__/verification.concurrent.test.ts` — the harness
- `test/db-test-utils.ts` — the single-connection harness this works around
- `server/storage/__tests__/verification.test.ts` — same module's standard
  (single-connection) tests

## See Also

- `docs/solutions/design-patterns/recompute-aggregate-under-lock-2026-05-17.md`
  — the concurrency fix this harness verifies
