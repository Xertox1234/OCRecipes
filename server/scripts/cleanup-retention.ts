/* eslint-disable no-console */
/**
 * Data retention cleanup script.
 *
 * Purges user data older than the retention windows defined in
 * `server/lib/retention-policy.ts`. Satisfies the CCPA/PIPEDA data
 * minimisation principle and bounds growth in high-churn tables.
 *
 * Domains:
 *   - `scanned_items` — granular scan history (retention: 365d)
 *   - `chat_conversations` — coach/recipe chat threads, messages cascade
 *     via FK (retention: 180d, scoped by `updatedAt`)
 *   - `daily_logs` — daily nutrition log rows (retention: 730d)
 *
 * Safety:
 *   - In `NODE_ENV=production`, the job refuses to run unless
 *     `RETENTION_CLEANUP_ENABLED=true`. Same safety pattern as
 *     `seed-recipes.ts::--allow-prod-seed`.
 *   - Active users — anyone with an unexpired subscription OR a chat /
 *     scan signal in the last `ACTIVE_USER_WINDOW_DAYS` — are exempt
 *     from purges. Their old data is preserved.
 *   - Deletes run in batches of `BATCH_SIZE` rows, looping until a
 *     batch returns fewer rows than the limit. This keeps each
 *     transaction short.
 *   - The script does NOT support `--force`. There is no way to bypass
 *     the production gate from this script.
 *
 * Usage (standalone):
 *   npm run cleanup:retention                      # local / dev
 *   RETENTION_CLEANUP_ENABLED=true \
 *     NODE_ENV=production \
 *     npm run cleanup:retention                    # production
 *
 * Scheduled invocation:
 *   See `server/index.ts` — wires this job into a daily node-cron task
 *   when `RETENTION_CLEANUP_ENABLED=true`.
 *
 * Postgres quirk:
 *   PostgreSQL does NOT support `LIMIT` on `DELETE`. To batch, we
 *   delete by `ctid` matched from a subquery with `LIMIT`. See
 *   `purgeBatch()` below.
 */
import "dotenv/config";
import { sql } from "drizzle-orm";
import { db, pool } from "../db";
import { createServiceLogger, toError } from "../lib/logger";
import {
  ACTIVE_USER_WINDOW_DAYS,
  BATCH_SIZE,
  CHAT_RETENTION_DAYS,
  DAILY_LOGS_RETENTION_DAYS,
  SCANNED_ITEMS_RETENTION_DAYS,
  cutoffFor,
  daysToMs,
} from "../lib/retention-policy";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

const log = createServiceLogger("retention-cleanup");

export type RetentionDb = NodePgDatabase<typeof schema>;

export interface PurgeResult {
  domain: string;
  rowsDeleted: number;
  retentionDays: number;
}

/**
 * Strict whitelist of SQL identifiers this script is allowed to splice into
 * raw SQL. Every value passed through `sql.raw()` MUST be present here.
 * Adding a new domain requires adding the table and its time/user columns
 * to this set. Keeps the `sql.raw()` usage in `purgeBatch` safe even if a
 * future refactor forwards a caller-supplied string by accident.
 */
const ALLOWED_IDENTIFIERS = new Set<string>([
  "chat_conversations",
  "scanned_items",
  "daily_logs",
  "logged_at",
  "scanned_at",
  "updated_at",
  "user_id",
]);

function assertAllowedIdentifier(name: string): void {
  if (!ALLOWED_IDENTIFIERS.has(name)) {
    throw new Error(
      `retention cleanup: refusing to splice unknown SQL identifier "${name}"`,
    );
  }
}

/**
 * Returns the set of user IDs that should be exempt from retention
 * purges. A user is considered active if any of these are true:
 *   - subscription_expires_at is in the future
 *   - they have a chat conversation updated within
 *     ACTIVE_USER_WINDOW_DAYS
 *   - they have a scanned item from within ACTIVE_USER_WINDOW_DAYS
 *
 * The result is a `Set<string>` for O(1) membership checks during
 * per-user filtering. We materialise the IDs (rather than joining at
 * delete time) so the same exemption snapshot is reused for every
 * domain in the same run — keeping behaviour predictable even if a
 * user becomes active mid-job.
 */
export async function getActiveUserIds(
  database: RetentionDb = db,
  now: Date = new Date(),
): Promise<Set<string>> {
  const activeCutoff = new Date(
    now.getTime() - daysToMs(ACTIVE_USER_WINDOW_DAYS),
  );
  const rows = await database.execute<{ id: string }>(sql`
    SELECT DISTINCT u.id
    FROM users u
    WHERE u.subscription_expires_at IS NOT NULL
      AND u.subscription_expires_at > ${now}
    UNION
    SELECT DISTINCT s.user_id AS id
    FROM scanned_items s
    WHERE s.scanned_at > ${activeCutoff}
    UNION
    SELECT DISTINCT c.user_id AS id
    FROM chat_conversations c
    WHERE c.updated_at > ${activeCutoff}
  `);
  // node-postgres returns rows on `.rows`; drizzle's typed `execute` returns
  // a result that exposes the rows array directly in newer versions. Handle
  // both shapes defensively to stay forward-compatible.
  const list = Array.isArray(rows)
    ? (rows as { id: string }[])
    : ((rows as { rows?: { id: string }[] }).rows ?? []);
  return new Set(list.map((r) => r.id));
}

/**
 * Run one batch DELETE against a table, filtered by:
 *   - the configured time column < cutoff
 *   - user_id NOT IN (active users)
 *
 * Returns the number of rows deleted. The caller loops until this is
 * less than BATCH_SIZE.
 *
 * Implementation note: Postgres does not support `LIMIT` on `DELETE`.
 * We select `ctid` (the row's physical address) from a LIMITed
 * subquery and delete by ctid. This is the standard idiom and is
 * race-safe because ctid uniquely identifies a tuple within a single
 * statement.
 */
async function purgeBatch(
  database: RetentionDb,
  tableName: string,
  timeColumn: string,
  userIdColumn: string,
  cutoff: Date,
  excludedUserIds: string[],
  batchSize: number,
): Promise<number> {
  // `sql.identifier()` is not available on this drizzle version; the table /
  // column names are caller-controlled constants (never user input). The
  // whitelist below is a defense-in-depth guard so a future refactor that
  // accidentally forwards an untrusted string still fails closed instead of
  // splicing arbitrary SQL.
  assertAllowedIdentifier(tableName);
  assertAllowedIdentifier(timeColumn);
  assertAllowedIdentifier(userIdColumn);
  const tableId = sql.raw(tableName);
  const timeId = sql.raw(timeColumn);
  const userId = sql.raw(userIdColumn);

  // Exclude active users via a SQL array parameter rather than expanding the
  // ID list inline. A `NOT IN (...)` clause with one parameter per id can
  // exceed Postgres's parameter limit (≈65k) once the active-user population
  // grows. `<> ALL($1::text[])` passes one array parameter regardless of
  // size and lets the planner handle the membership test internally. When
  // the exclusion set is empty we emit a tautology because `<> ALL('{}')`
  // would be `TRUE` for any value anyway, but skipping the predicate keeps
  // EXPLAIN plans cleaner.
  const excludeClause =
    excludedUserIds.length === 0
      ? sql`TRUE`
      : sql`${userId} <> ALL(${excludedUserIds}::text[])`;

  const result = await database.execute<{ ctid: unknown }>(sql`
    DELETE FROM ${tableId}
    WHERE ctid IN (
      SELECT ctid FROM ${tableId}
      WHERE ${timeId} < ${cutoff}
        AND ${excludeClause}
      LIMIT ${batchSize}
    )
  `);
  // pg returns `rowCount`. Drizzle's typed wrapper exposes the underlying pg
  // result; check both shapes defensively.
  const rowCount =
    (result as { rowCount?: number | null }).rowCount ??
    (Array.isArray(result) ? result.length : 0);
  return rowCount ?? 0;
}

async function purgeDomain(
  database: RetentionDb,
  domain: string,
  tableName: string,
  timeColumn: string,
  userIdColumn: string,
  retentionDays: number,
  excludedUserIds: string[],
  now: Date,
  batchSize: number = BATCH_SIZE,
): Promise<PurgeResult> {
  if (!Number.isFinite(retentionDays)) {
    log.info({ domain, retentionDays }, "retention disabled — skipping purge");
    return { domain, rowsDeleted: 0, retentionDays };
  }

  const cutoff = cutoffFor(retentionDays, now);
  let total = 0;
  // Hard ceiling on iterations so a bug or a constantly-growing exclusion
  // set can't spin forever. 10M rows / batch is well above any plausible
  // single-night purge.
  const MAX_ITERATIONS = 10_000;

  let hitMaxIterations = false;
  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const deleted = await purgeBatch(
      database,
      tableName,
      timeColumn,
      userIdColumn,
      cutoff,
      excludedUserIds,
      batchSize,
    );
    total += deleted;
    if (deleted < batchSize) break;
    if (i === MAX_ITERATIONS - 1) {
      hitMaxIterations = true;
    }
  }

  if (hitMaxIterations) {
    // Loop exited because the iteration cap fired, not because the table is
    // drained. Rows eligible for purge remain — surface a warning so the
    // operator notices and can re-run, raise the cap, or shrink the batch.
    log.warn(
      {
        domain,
        rowsDeleted: total,
        retentionDays,
        maxIterations: MAX_ITERATIONS,
      },
      "retention purge hit MAX_ITERATIONS — eligible rows remain; re-run required",
    );
  }

  log.info(
    { domain, rowsDeleted: total, retentionDays },
    "retention purge completed",
  );
  return { domain, rowsDeleted: total, retentionDays };
}

let isRunning = false;

/**
 * Test-only escape hatch. The `isRunning` flag is module-level state — if a
 * test interrupts a `runRetentionCleanup()` call (timeout, throw) the flag
 * can leak and silently turn every subsequent invocation into a no-op.
 * Tests call this in `afterEach` to guarantee a clean baseline.
 */
export function _resetRunningStateForTests(): void {
  isRunning = false;
}

/**
 * Run the full retention cleanup. Exposed for tests and for the
 * standalone CLI entry point. Callers must enforce the production
 * safety gate themselves — see `assertExecutionAllowed()`.
 */
export async function runRetentionCleanup(
  database: RetentionDb = db,
  now: Date = new Date(),
): Promise<PurgeResult[]> {
  if (isRunning) {
    log.warn("retention cleanup already running — skipping overlapping run");
    return [];
  }
  isRunning = true;
  try {
    const excludedUserIds = Array.from(await getActiveUserIds(database, now));
    log.info(
      { excludedUserCount: excludedUserIds.length },
      "retention cleanup: starting run",
    );

    const results: PurgeResult[] = [];

    // Chat conversations: scope by `updated_at` (most recent activity in
    // the thread). Messages cascade via the existing FK
    // `chat_messages.conversation_id ON DELETE CASCADE`, so deleting the
    // conversation row reclaims everything in one pass.
    results.push(
      await purgeDomain(
        database,
        "chat_conversations",
        "chat_conversations",
        "updated_at",
        "user_id",
        CHAT_RETENTION_DAYS,
        excludedUserIds,
        now,
      ),
    );

    // Daily logs (recipe- and scan-sourced). Run BEFORE the scanned_items
    // purge so the `logged_at` window applies to scan-sourced logs first.
    // If scanned_items ran first, its `ON DELETE CASCADE` on
    // `daily_logs.scanned_item_id` would prune scan-sourced logs at the
    // scanned_items window (365d) instead of the daily_logs window (730d),
    // making the DAILY_LOGS_RETENTION_DAYS constant misleading. Running
    // daily_logs first ensures the policy constant matches reality for both
    // recipe- and scan-sourced log rows.
    //
    // Note: scan-sourced logs whose parent scanned_item is *older* than
    // SCANNED_ITEMS_RETENTION_DAYS will still be cascade-pruned by the
    // next purge — that is intended: the scanned_items policy is the
    // floor on its dependent logs.
    results.push(
      await purgeDomain(
        database,
        "daily_logs",
        "daily_logs",
        "logged_at",
        "user_id",
        DAILY_LOGS_RETENTION_DAYS,
        excludedUserIds,
        now,
      ),
    );

    // Scanned items: scope by `scanned_at`. Any daily_logs rows still
    // referencing a scanned_item older than SCANNED_ITEMS_RETENTION_DAYS
    // cascade-delete via the existing FK.
    results.push(
      await purgeDomain(
        database,
        "scanned_items",
        "scanned_items",
        "scanned_at",
        "user_id",
        SCANNED_ITEMS_RETENTION_DAYS,
        excludedUserIds,
        now,
      ),
    );

    return results;
  } finally {
    isRunning = false;
  }
}

/**
 * Guard for production safety. Throws when the environment is
 * `NODE_ENV=production` and `RETENTION_CLEANUP_ENABLED` is not
 * exactly `"true"`. Otherwise returns silently.
 */
export function assertExecutionAllowed(
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (env.NODE_ENV !== "production") return;
  if (env.RETENTION_CLEANUP_ENABLED === "true") return;
  throw new Error(
    "Retention cleanup refused: NODE_ENV=production requires " +
      "RETENTION_CLEANUP_ENABLED=true to run.",
  );
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

// Only run main() when invoked directly via `tsx`/`node`, not when imported
// by the cron wiring in `server/index.ts` or by tests.
const isMain = (() => {
  try {
    const argv1 = process.argv[1];
    return Boolean(argv1 && argv1.includes("cleanup-retention"));
  } catch {
    return false;
  }
})();

async function main() {
  try {
    assertExecutionAllowed();
  } catch (err) {
    console.error((err as Error).message);
    process.exit(1);
  }

  console.log("=== Retention Cleanup ===");
  console.log(
    `scanned_items:      ${SCANNED_ITEMS_RETENTION_DAYS} days\n` +
      `chat_conversations: ${CHAT_RETENTION_DAYS} days\n` +
      `daily_logs:         ${DAILY_LOGS_RETENTION_DAYS} days\n` +
      `active-user window: ${ACTIVE_USER_WINDOW_DAYS} days (exempt)\n`,
  );

  try {
    const results = await runRetentionCleanup();
    for (const r of results) {
      console.log(
        `  ${r.domain.padEnd(20)} rowsDeleted=${r.rowsDeleted}  retentionDays=${r.retentionDays}`,
      );
    }
    console.log("=== Cleanup complete ===");
  } catch (err) {
    log.error({ err: toError(err) }, "retention cleanup failed");
    console.error("Retention cleanup failed:", (err as Error).message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (isMain) {
  main();
}
