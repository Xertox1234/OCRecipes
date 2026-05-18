/* eslint-disable no-console */
/**
 * One-off repair: undo the kg→lb storage corruption in `weight_logs`.
 *
 * Manual weight entries logged from `WeightTrackingScreen` before the forward
 * fix (PR #220) were stored at `realKg * KG_PER_LB`: the client never sent a
 * `unit`, the route defaulted to `"lb"`, and the handler "normalised to kg" by
 * multiplying. This script reverses that for the affected rows and re-syncs the
 * dependent `users.weight` value.
 *
 * Corruption cannot be read off any single column — the route always stores
 * `unit = "kg"`. A row is corrupted iff: `source = 'manual'` (HealthKit / scale
 * rows legitimately sent kg) AND it was logged BEFORE the forward fix deployed.
 * The deploy time is supplied via `--cutoff`; it is not derivable from git.
 *
 * SAFETY MODEL
 *   - Dry-run by default. Writes only with `--execute`.
 *   - `--execute` refuses to run twice: it writes an audit/marker JSON file and
 *     aborts if that file already exists. A `completed` marker can be overridden
 *     with `--force`; a `pending` marker (a crashed prior run) cannot — the
 *     operator must investigate and remove it by hand. The audit file also
 *     records every before/after value for rollback.
 *   - Rows that reverse to an implausible weight are flagged `needs-review` and
 *     left untouched — never auto-corrected.
 *   - `goalWeight` is intentionally NOT touched: it is set during onboarding /
 *     goal-setup and is never synced from a weight log, so the bug never reached
 *     it. See `createWeightLogAndUpdateUser` (server/storage/health.ts).
 *
 * Usage:
 *   # 1. Inspect blast radius (no writes):
 *   npx tsx server/scripts/repair-weight-log-units.ts --cutoff 2026-05-18T13:29:43Z
 *
 *   # 2. Apply the repair:
 *   npx tsx server/scripts/repair-weight-log-units.ts --cutoff 2026-05-18T13:29:43Z --execute
 *
 * The forward fix is commit ac027cb7 (PR #220), authored 2026-05-18 07:29:43
 * -0600 (= 2026-05-18T13:29:43Z). Use the actual *production deploy* time as
 * the cutoff — the merge time only if deploy == merge.
 *
 * Run during low-traffic / idle time: candidate rows are read before the
 * transaction opens, so a manual weight log inserted mid-run could be missed.
 */
import "dotenv/config";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { db, pool } from "../db";
import {
  classifyRow,
  parseCutoffArg,
  restoreKgFromCorrupted,
  type WeightRow,
} from "./repair-weight-log-units-utils";

type Args = {
  cutoff: Date;
  execute: boolean;
  force: boolean;
  auditFile: string;
};

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    cutoff: parseCutoffArg(get("--cutoff")),
    execute: argv.includes("--execute"),
    force: argv.includes("--force"),
    auditFile: get("--audit-file") ?? "weight-log-units-repair.audit.json",
  };
}

/** `source, unit` blast-radius breakdown over the whole table. */
async function printBlastRadius(): Promise<void> {
  const { rows } = await db.execute<{
    source: string | null;
    unit: string | null;
    n: string;
    min_weight: string | null;
    max_weight: string | null;
  }>(sql`
    SELECT source, unit, COUNT(*) AS n,
           MIN(weight) AS min_weight, MAX(weight) AS max_weight
    FROM weight_logs
    GROUP BY source, unit
    ORDER BY source, unit
  `);

  console.log("\nBlast radius — weight_logs by (source, unit):");
  if (rows.length === 0) {
    console.log("  (table is empty)");
    return;
  }
  for (const r of rows) {
    console.log(
      `  source=${r.source ?? "NULL"} unit=${r.unit ?? "NULL"}  ` +
        `count=${r.n}  weight[min..max]=${r.min_weight}..${r.max_weight}`,
    );
  }
  const nonKg = rows.filter((r) => r.unit !== "kg");
  if (nonKg.length > 0) {
    console.log(
      "  WARNING: rows with unit != 'kg' exist — the route always stores 'kg'. " +
        "Investigate before assuming all pre-cutoff manual rows are corrupted.",
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  console.log("weight_logs unit-corruption repair");
  console.log(
    `  mode:        ${args.execute ? "EXECUTE (writes)" : "dry-run"}`,
  );
  console.log(
    `  cutoff:      ${args.cutoff.toISOString()} (rows logged before this are candidates)`,
  );
  console.log(`  audit file:  ${args.auditFile}`);

  await printBlastRadius();

  // Candidate rows: manual entries logged before the forward fix. Fetched in
  // full (one row per user per day — small) so each can be classified in-code.
  const { rows: rawCandidates } = await db.execute<{
    id: number;
    user_id: string;
    weight: string;
    source: string | null;
    logged_at: string | Date;
  }>(sql`
    SELECT id, user_id, weight, source, logged_at
    FROM weight_logs
    WHERE (source = 'manual' OR source IS NULL)
      AND logged_at < ${args.cutoff}
    ORDER BY user_id, logged_at
  `);

  const candidates: WeightRow[] = rawCandidates.map((r) => ({
    id: r.id,
    userId: r.user_id,
    weight: Number(r.weight),
    source: r.source,
    loggedAt: new Date(r.logged_at),
  }));

  const corrupted = candidates.filter(
    (r) => classifyRow(r, args.cutoff) === "corrupted",
  );
  const needsReview = candidates.filter(
    (r) => classifyRow(r, args.cutoff) === "needs-review",
  );
  const affectedUserIds = [...new Set(corrupted.map((r) => r.userId))];

  console.log(
    `\nCandidates (manual, pre-cutoff): ${candidates.length}` +
      `  -> corrupted: ${corrupted.length}` +
      `  needs-review: ${needsReview.length}`,
  );
  console.log(`Affected users: ${affectedUserIds.length}`);

  if (corrupted.length > 0) {
    console.log("\nSample corrections (id: storedKg -> restoredKg):");
    for (const r of corrupted.slice(0, 10)) {
      console.log(
        `  #${r.id}  ${r.weight.toFixed(2)} -> ${restoreKgFromCorrupted(r.weight).toFixed(2)}`,
      );
    }
    if (corrupted.length > 10) {
      console.log(`  ... and ${corrupted.length - 10} more`);
    }
  }

  if (needsReview.length > 0) {
    console.log(
      "\nNEEDS REVIEW — reversing these yields an implausible weight; NOT corrected:",
    );
    for (const r of needsReview) {
      console.log(
        `  #${r.id}  user=${r.userId}  storedKg=${r.weight.toFixed(2)}  ` +
          `-> ${restoreKgFromCorrupted(r.weight).toFixed(2)} (implausible)`,
      );
    }
  }

  console.log(
    "\nNote: users.goalWeight is never synced from weight_logs " +
      "(createWeightLogAndUpdateUser sets only users.weight) — nothing to correct there.",
  );

  if (!args.execute) {
    console.log(
      "\nDry-run complete. Re-run with --execute to apply the corrections above.",
    );
    await pool.end();
    return;
  }

  // --- Execute path ---------------------------------------------------------
  if (existsSync(args.auditFile)) {
    let priorStatus: string | undefined;
    try {
      priorStatus = (
        JSON.parse(readFileSync(args.auditFile, "utf8")) as {
          status?: string;
        }
      ).status;
    } catch {
      priorStatus = undefined;
    }
    if (priorStatus === "pending") {
      // A `pending` marker means a prior run crashed mid-repair: it may have
      // committed the transaction (DB already corrected) or not. --force cannot
      // resolve that ambiguity, so it is rejected here — the operator must
      // inspect weight_logs against the marker's recorded values and delete the
      // marker by hand before re-running.
      console.error(
        `\nABORT: audit file "${args.auditFile}" has status "pending" — a ` +
          "previous run did not finish. The database may already be partially " +
          "or fully repaired. Inspect it against the marker file, then delete " +
          "the marker manually before re-running. --force will NOT override this.",
      );
      await pool.end();
      process.exitCode = 1;
      return;
    }
    if (!args.force) {
      console.error(
        `\nABORT: audit file "${args.auditFile}" already exists — this repair ` +
          "appears to have completed. Re-running would double-correct (inflate) " +
          "values. Pass --force only if you are certain a fresh run is needed.",
      );
      await pool.end();
      process.exitCode = 1;
      return;
    }
  }

  if (corrupted.length === 0) {
    console.log("\nNothing to correct. Exiting without writes.");
    await pool.end();
    return;
  }

  const userIdList = sql.join(
    affectedUserIds.map((id) => sql`${id}`),
    sql`, `,
  );

  // Capture every pre-repair value the repair will overwrite, for the rollback
  // record: weight_logs row weights (deterministic) and users.weight.
  const { rows: userBefore } = await db.execute<{
    id: string;
    weight: string | null;
  }>(sql`SELECT id, weight FROM users WHERE id IN (${userIdList})`);
  const weightBeforeByUser = new Map(
    userBefore.map((u) => [u.id, u.weight != null ? Number(u.weight) : null]),
  );

  const correctedRows = corrupted.map((r) => ({
    id: r.id,
    userId: r.userId,
    before: r.weight,
    after: restoreKgFromCorrupted(r.weight),
  }));

  type UserWeightUpdate = {
    userId: string;
    before: number | null;
    after: number;
  };
  let userUpdates: UserWeightUpdate[] = [];

  // Idempotency marker — written BEFORE any DB write. A failed file write
  // aborts before the transaction (no DB change). The marker doubles as the
  // rollback record: the `pending` write already holds every pre-repair value.
  // The post-commit `completed` rewrite only enriches it with the resulting
  // users.weight values, so that rewrite failing is harmless — the marker is
  // still present, so a re-run blocks rather than silently double-correcting.
  const writeAudit = (status: "pending" | "completed"): void => {
    writeFileSync(
      args.auditFile,
      JSON.stringify(
        {
          status,
          completedAt: status === "completed" ? new Date().toISOString() : null,
          cutoff: args.cutoff.toISOString(),
          correctedRows,
          usersBefore: [...weightBeforeByUser].map(([id, weight]) => ({
            id,
            weight,
          })),
          userWeightUpdates: userUpdates,
          needsReviewRowIds: needsReview.map((r) => r.id),
        },
        null,
        2,
      ),
    );
  };
  writeAudit("pending");

  try {
    await db.transaction(async (tx) => {
      // Correct the corrupted weight_logs rows.
      await Promise.all(
        correctedRows.map((r) =>
          tx.execute(
            sql`UPDATE weight_logs SET weight = ${r.after.toFixed(2)} WHERE id = ${r.id}`,
          ),
        ),
      );
      // Re-sync users.weight to each affected user's most-recent log — read
      // INSIDE the transaction so it reflects the just-corrected weights and is
      // serialized against concurrent weight-log writes. This restores the
      // invariant kept by createWeightLogAndUpdateUser / deleteWeightLog.
      const { rows: latestRows } = await tx.execute<{
        user_id: string;
        weight: string;
      }>(sql`
        SELECT DISTINCT ON (user_id) user_id, weight
        FROM weight_logs
        WHERE user_id IN (${userIdList})
        ORDER BY user_id, logged_at DESC
      `);
      userUpdates = latestRows.map((r) => ({
        userId: r.user_id,
        before: weightBeforeByUser.get(r.user_id) ?? null,
        after: Number(r.weight),
      }));
      await Promise.all(
        userUpdates.map((u) =>
          tx.execute(
            sql`UPDATE users SET weight = ${u.after.toFixed(2)} WHERE id = ${u.userId}`,
          ),
        ),
      );
    });
  } catch (err) {
    // Transaction rolled back — remove the now-misleading marker so a retry is
    // not blocked.
    rmSync(args.auditFile, { force: true });
    throw err;
  }

  // Enrich the marker with the resulting users.weight values. Best-effort: the
  // marker already exists from the `pending` write, so a failure here cannot
  // cause a double-correction.
  try {
    writeAudit("completed");
  } catch (err) {
    console.warn(
      `WARNING: could not rewrite the completed audit file (${String(err)}). ` +
        "The pending marker is still present — do NOT re-run without --force.",
    );
  }

  console.log(
    `\nDONE. Corrected ${correctedRows.length} weight_logs row(s), ` +
      `re-synced ${userUpdates.length} users.weight value(s).`,
  );
  console.log(`Audit + rollback record written to ${args.auditFile}`);
  await pool.end();
}

main().catch(async (err) => {
  console.error("Repair failed:", err);
  await pool.end().catch(() => undefined);
  process.exit(1);
});
