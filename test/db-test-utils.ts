/**
 * Database integration test utilities.
 *
 * Provides transaction-based test isolation: each test runs inside a
 * transaction that is rolled back in afterEach, so no data leaks between tests.
 *
 * IMPORTANT: This module uses module-level mutable state (testClient, testTx).
 * It relies on Vitest running each test file in its own worker (the default
 * "forks" or "threads" pool mode). Do NOT use with singleThread or
 * fileParallelism: false, as that would share state across test files.
 *
 * Savepoint isolation
 * -------------------
 * Storage functions that call `db.transaction(cb)` internally would normally
 * issue a top-level `BEGIN/COMMIT` via Drizzle's `NodePgSession.transaction`.
 * That inner COMMIT ends the outer test transaction, leaking writes past
 * `rollbackTestTransaction()`. To prevent this, `setupTestTransaction()` opens
 * a real Drizzle transaction (yielding a `NodePgTransaction` instance) and
 * returns that instance as the test's `tx`. Inside a `NodePgTransaction`,
 * `.transaction(cb)` emits `SAVEPOINT/RELEASE SAVEPOINT` instead of
 * `BEGIN/COMMIT`, so the outer test rollback unwinds all nested writes.
 */
import pg from "pg";
import {
  drizzle,
  type NodePgDatabase,
  NodePgTransaction,
} from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

const { Pool } = pg;

// Shared pool for all storage integration tests
let testPool: pg.Pool | null = null;

function getPool(): pg.Pool {
  if (!testPool) {
    testPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 2, // Only need 1 active + 1 buffer per worker
      // Match server/db.ts: force UTC so CURRENT_TIMESTAMP defaults align
      // with Drizzle's UTC-based timestamp handling.
      options: "-c timezone=UTC",
    });
  }
  return testPool;
}

// Per-test transaction state
let testClient: pg.PoolClient | null = null;
let testTx: NodePgDatabase<typeof schema> | null = null;
// Sentinel-driven rollback machinery (see setupTestTransaction below).
let triggerRollback: (() => void) | null = null;
let outerTxPromise: Promise<void> | null = null;

// Unique sentinel used to abort the outer Drizzle transaction cleanly.
// We compare by identity in the catch block, so this object cannot collide
// with any user-thrown error.
const ROLLBACK_SENTINEL: { __testRollback: true } = { __testRollback: true };

/**
 * Call in beforeEach. Acquires a connection, opens a Drizzle transaction,
 * and returns the inner `NodePgTransaction` instance scoped to that
 * connection. Because the returned object is a `NodePgTransaction`,
 * subsequent `db.transaction(cb)` calls inside storage code emit SAVEPOINT
 * (not BEGIN/COMMIT) and therefore roll back with the outer test transaction.
 */
export async function setupTestTransaction(): Promise<
  NodePgDatabase<typeof schema>
> {
  if (testClient) {
    throw new Error(
      "setupTestTransaction() called while a transaction is already active. " +
        "Did you forget to call rollbackTestTransaction() in afterEach?",
    );
  }
  const pool = getPool();
  const client = await pool.connect();

  const db = drizzle(client, { schema });

  // Capture the inner NodePgTransaction Drizzle hands to its callback.
  let txReadyResolve: (tx: NodePgDatabase<typeof schema>) => void;
  let txReadyReject: (err: unknown) => void;
  const txReady = new Promise<NodePgDatabase<typeof schema>>((res, rej) => {
    txReadyResolve = res;
    txReadyReject = rej;
  });

  // Promise the callback awaits. Rejecting it (via triggerRollback) causes
  // Drizzle to ROLLBACK and rethrow our sentinel, which we then swallow.
  let rejectRollbackSignal: (err: unknown) => void;
  const rollbackSignal = new Promise<never>((_, rej) => {
    rejectRollbackSignal = rej;
  });

  // Fire the outer transaction. We deliberately do NOT await it here — the
  // callback parks on `rollbackSignal`, so the transaction stays open until
  // `rollbackTestTransaction()` triggers the sentinel.
  const txPromise = db
    .transaction(async (tx) => {
      txReadyResolve(tx as unknown as NodePgDatabase<typeof schema>);
      // Park until the test signals rollback. Always rejects.
      await rollbackSignal;
    })
    .catch((err) => {
      if (err === ROLLBACK_SENTINEL) return; // Expected — outer ROLLBACK fired.
      throw err;
    });

  // If the outer transaction errors before the callback resolves (e.g. BEGIN
  // failed), surface that to the awaiter of setupTestTransaction.
  txPromise.catch(txReadyReject!);

  let tx: NodePgDatabase<typeof schema>;
  try {
    tx = await txReady;
  } catch (err) {
    client.release(true);
    throw err;
  }

  testClient = client;
  testTx = tx;
  triggerRollback = () => rejectRollbackSignal(ROLLBACK_SENTINEL);
  outerTxPromise = txPromise;

  return tx;
}

/**
 * Call in afterEach. Rolls back the transaction and releases the connection.
 */
export async function rollbackTestTransaction(): Promise<void> {
  if (!testClient) return;
  const client = testClient;
  const trigger = triggerRollback;
  const promise = outerTxPromise;
  testClient = null;
  testTx = null;
  triggerRollback = null;
  outerTxPromise = null;
  try {
    trigger?.();
    if (promise) await promise;
  } finally {
    client.release(true);
  }
}

/**
 * Call in afterAll. Closes the shared pool.
 */
export async function closeTestPool(): Promise<void> {
  if (testPool) {
    await testPool.end();
    testPool = null;
  }
}

/**
 * Returns the current transaction-scoped Drizzle instance.
 * Throws if called outside of a setupTestTransaction / rollbackTestTransaction cycle.
 */
export function getTestTx(): NodePgDatabase<typeof schema> {
  if (!testTx) {
    throw new Error(
      "getTestTx() called outside of a test transaction. Did you call setupTestTransaction() in beforeEach?",
    );
  }
  return testTx;
}

// Marker re-export so consumers can assert the savepoint-emitting variant is
// in use (e.g. in the regression test). Not part of the public test API.
export { NodePgTransaction as _NodePgTransaction };

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

let userSeq = 0;

/**
 * Inserts a minimal user and returns it. Username is auto-generated to avoid
 * collisions within a transaction.
 */
export async function createTestUser(
  tx: NodePgDatabase<typeof schema>,
  overrides: Partial<schema.InsertUser> = {},
): Promise<schema.User> {
  userSeq++;
  const defaults: schema.InsertUser = {
    username: `testuser_${userSeq}_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`,
    password: "hashed_password_placeholder",
    ...overrides,
  };
  const [user] = await tx.insert(schema.users).values(defaults).returning();
  return user;
}

/**
 * Inserts a minimal user profile for the given userId.
 */
export async function createTestUserProfile(
  tx: NodePgDatabase<typeof schema>,
  userId: string,
  overrides: Partial<schema.InsertUserProfile> = {},
): Promise<schema.UserProfile> {
  const defaults: schema.InsertUserProfile = {
    userId,
    activityLevel: "moderate",
    dietType: "balanced",
    ...overrides,
  };
  const [profile] = await tx
    .insert(schema.userProfiles)
    .values(defaults)
    .returning();
  return profile;
}
