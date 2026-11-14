import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { logger } from "./lib/logger";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Server-enforced cap on any single statement. Request queries and the
// retention cron (batched deletes) finish well inside it, as do the chunked
// backfills. A script that runs one large unbatched statement (e.g.
// backfill-email-verified.ts) can raise the cap, or pass 0 to disable it, with
// DB_STATEMENT_TIMEOUT_MS.
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000;

// Plain digits only: Number("") is 0, so a blank variable (an empty Railway
// value) would otherwise switch a limit off.
function parseMilliseconds(value: string | undefined): number | undefined {
  return value !== undefined && /^\d+$/.test(value) ? Number(value) : undefined;
}

const statementTimeoutMs =
  parseMilliseconds(process.env.DB_STATEMENT_TIMEOUT_MS) ??
  DEFAULT_STATEMENT_TIMEOUT_MS;

// Unset everywhere except the iOS E2E job, which passes 0 so pg never closes
// an idle connection. On that starved runner, Postgres took 6-8 s to start a
// new backend (run 43120554293), more than connectionTimeoutMillis, so every
// burst after an idle gap had to reopen connections and some timed out.
const idleTimeoutMs = parseMilliseconds(process.env.DB_POOL_IDLE_TIMEOUT_MS);

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Pin the session timezone to UTC. All timestamp columns are timestamptz, so
  // values round-trip in UTC regardless; this pin keeps CURRENT_TIMESTAMP
  // column defaults consistent and guards any future naked `timestamp` column.
  options: "-c timezone=UTC",
  // Without these, a pool whose connections are all busy makes every new
  // request — the health check included — wait forever instead of failing,
  // and one runaway query can hold a connection indefinitely.
  connectionTimeoutMillis: 5_000,
  statement_timeout: statementTimeoutMs,
  // A session left idle inside a transaction (leaked client, crashed handler)
  // would hold its row locks forever. Sessions that keep running statements
  // are unaffected, so the batch cleanup scripts are safe.
  idle_in_transaction_session_timeout: 60_000,
  ...(idleTimeoutMs !== undefined && { idleTimeoutMillis: idleTimeoutMs }),
});

pool.on("error", (err) => {
  logger.error({ err }, "unexpected database pool error");
});

export const db = drizzle(pool, { schema });
