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

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Pin the session timezone to UTC. All timestamp columns are timestamptz, so
  // values round-trip in UTC regardless; this pin keeps CURRENT_TIMESTAMP
  // column defaults consistent and guards any future naked `timestamp` column.
  options: "-c timezone=UTC",
  // pg defaults to waiting forever for a pooled client and to no statement
  // timeout, so pool exhaustion (lock contention, a DB brownout) or one
  // runaway query would queue every request indefinitely. Fail fast instead.
  // statement_timeout is a server-enforced startup GUC; it also bounds waits
  // on pg_advisory_xact_lock. Generous enough for the one-off backfill scripts.
  connectionTimeoutMillis: 10_000,
  statement_timeout: 60_000,
});

pool.on("error", (err) => {
  logger.error({ err }, "unexpected database pool error");
});

export const db = drizzle(pool, { schema });
