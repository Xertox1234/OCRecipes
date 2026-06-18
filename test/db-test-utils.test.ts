/**
 * Regression test for `setupTestTransaction()` savepoint isolation.
 *
 * Background: Before this fix, storage functions that called
 * `db.transaction(cb)` would issue a top-level `BEGIN/COMMIT` via Drizzle's
 * `NodePgSession`, which prematurely ended the outer test transaction and
 * leaked writes past `rollbackTestTransaction()`. The fix returns a
 * `NodePgTransaction` from `setupTestTransaction()` so inner
 * `db.transaction()` calls emit `SAVEPOINT/RELEASE SAVEPOINT` instead.
 *
 * Verification: we cannot assert "rollback removed the row" by querying on
 * the same `PoolClient` we just rolled back — MVCC visibility shows the row
 * absent regardless of whether the bug is fixed. We must open a SEPARATE
 * connection (independent pool) to observe committed state.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { sql } from "drizzle-orm";
import crypto from "node:crypto";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  _NodePgTransaction,
} from "./db-test-utils";
import * as schema from "@shared/schema";

const { Pool } = pg;

// Independent pool, used only to observe committed state from outside the
// test transaction. Cannot share connections with the test pool, or rollback
// visibility semantics would mask the bug we're testing for.
let observerPool: pg.Pool;

beforeAll(() => {
  observerPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    options: "-c timezone=UTC",
  });
});

afterAll(async () => {
  await observerPool.end();
  await closeTestPool();
});

describe("setupTestTransaction — savepoint isolation", () => {
  it("returns a NodePgTransaction (so storage db.transaction() uses SAVEPOINT)", async () => {
    const tx = await setupTestTransaction();
    try {
      expect(tx).toBeInstanceOf(_NodePgTransaction);
    } finally {
      await rollbackTestTransaction();
    }
  });

  it("rolls back writes performed inside a nested db.transaction() call", async () => {
    const tx = await setupTestTransaction();
    const username = `testuser_savepoint_regression_${Date.now()}_${crypto
      .randomUUID()
      .slice(0, 8)}`;
    try {
      // Insert a row inside a nested tx.transaction() — this is the call
      // pattern that previously leaked (storage functions like
      // submitVerification use exactly this shape).
      let insertedId: string | null = null;
      await tx.transaction(async (innerTx) => {
        const user = await createTestUser(innerTx, { username });
        insertedId = user.id;
      });
      expect(insertedId).not.toBeNull();

      // Sanity: visible inside the transaction.
      const inside = await tx.execute(
        sql`SELECT id FROM users WHERE username = ${username}`,
      );
      expect(inside.rows.length).toBe(1);
    } finally {
      // Roll back the outer test transaction even if assertions above failed,
      // so the next test's setupTestTransaction() doesn't error on a leaked
      // testClient.
      await rollbackTestTransaction();
    }

    // Verify via a SEPARATE connection: the row must NOT be visible in the
    // committed database state. If the bug regresses, the inner COMMIT
    // would have ended the outer transaction prematurely and the row would
    // persist past rollback.
    const observed = await observerPool.query(
      "SELECT id FROM users WHERE username = $1",
      [username],
    );
    expect(observed.rowCount).toBe(0);
  });

  it("rolls back direct tx writes (no nested transaction)", async () => {
    const tx = await setupTestTransaction();
    const username = `testuser_direct_regression_${Date.now()}_${crypto
      .randomUUID()
      .slice(0, 8)}`;
    try {
      await tx.insert(schema.users).values({
        username,
        email: `${username}@test.invalid`,
        password: "placeholder",
      });
    } finally {
      await rollbackTestTransaction();
    }

    const observed = await observerPool.query(
      "SELECT id FROM users WHERE username = $1",
      [username],
    );
    expect(observed.rowCount).toBe(0);
  });
});
