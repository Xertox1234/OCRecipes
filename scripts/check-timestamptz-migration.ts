#!/usr/bin/env tsx
/**
 * Fail-fast guard that runs before `db:push` (wired as the `predb:push` npm hook).
 *
 * shared/schema.ts defines every timestamp column as `timestamptz`. A populated
 * database that still has `timestamp without time zone` columns has not had
 * migrations/0002_timestamps_to_timestamptz.sql applied. drizzle-kit `push`
 * connects without a UTC session pin, so letting it convert those columns first
 * can silently shift stored values. This guard aborts the push in that case.
 *
 * Fresh/empty databases have no such columns and pass cleanly. The guard fails
 * closed: any inability to verify the database state aborts the push.
 *
 * Intentional bypass (e.g. a database you know is empty): SKIP_TIMESTAMPTZ_CHECK=1
 */
import "dotenv/config";
import pg from "pg";

const MIGRATION = "migrations/0002_timestamps_to_timestamptz.sql";

async function main(): Promise<void> {
  if (process.env.SKIP_TIMESTAMPTZ_CHECK === "1") {
    console.log(
      "[db:push guard] SKIP_TIMESTAMPTZ_CHECK=1 set — skipping timestamptz check.",
    );
    return;
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error(
      "[db:push guard] DATABASE_URL is not set — cannot verify database state.",
    );
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString });
  try {
    const { rows } = await pool.query<{
      table_name: string;
      column_name: string;
    }>(
      `SELECT table_name, column_name
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND data_type = 'timestamp without time zone'
        ORDER BY table_name, column_name`,
    );

    if (rows.length === 0) {
      console.log(
        "[db:push guard] OK — no legacy timestamp columns found; safe to push.",
      );
      return;
    }

    console.error(
      `\n[db:push guard] ABORTED — found ${rows.length} legacy "timestamp without time zone" column(s):\n`,
    );
    for (const row of rows) {
      console.error(`  - ${row.table_name}.${row.column_name}`);
    }
    console.error(
      `\nshared/schema.ts expects every timestamp column to be timestamptz.\n` +
        `Apply the migration FIRST, then re-run db:push:\n\n` +
        `  psql "$DATABASE_URL" -f ${MIGRATION}\n\n` +
        `Running db:push first connects without a UTC session pin and can\n` +
        `silently shift stored timestamp values.\n` +
        `(Intentional bypass — e.g. a database you know is empty: SKIP_TIMESTAMPTZ_CHECK=1)\n`,
    );
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("[db:push guard] Failed to verify database state:", err);
  process.exit(1);
});
