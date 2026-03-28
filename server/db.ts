import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Drizzle ORM interprets timestamp (without timezone) columns as UTC
  // (appends +0000 on read, sends toISOString() on write). We must ensure
  // PostgreSQL's session timezone matches so that CURRENT_TIMESTAMP defaults
  // also produce UTC values, preventing day-boundary mismatches.
  options: "-c timezone=UTC",
});

pool.on("error", (err) => {
  console.error("Unexpected database pool error:", err);
});

export const db = drizzle(pool, { schema });
