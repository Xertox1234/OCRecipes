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
 */
import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
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

/**
 * Call in beforeEach. Acquires a connection, starts a transaction, and returns
 * a Drizzle instance scoped to that transaction.
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
  try {
    await client.query("BEGIN");
    testClient = client;
    testTx = drizzle(client, { schema });
    return testTx;
  } catch (err) {
    client.release(true);
    throw err;
  }
}

/**
 * Call in afterEach. Rolls back the transaction and releases the connection.
 */
export async function rollbackTestTransaction(): Promise<void> {
  if (testClient) {
    try {
      await testClient.query("ROLLBACK");
    } catch {
      // Connection may already be in an error state; swallow so we can release.
    } finally {
      testClient.release(true);
      testClient = null;
      testTx = null;
    }
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
