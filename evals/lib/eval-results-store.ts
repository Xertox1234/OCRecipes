import { createHash } from "crypto";
import { execSync } from "child_process";
import pg from "pg";
import type { EvalRunResult, RubricScore } from "../types";

const { Client } = pg;

// PG Lab rail: "Postgres down or ocrecipes_lab missing -> no-op instantly" (design rail §2,
// docs/research/2026-07-05-pg-lab-roadmap.md). A short connect timeout keeps that no-op
// fast when the lab DB is simply not running locally — evals must never require Postgres.
// query_timeout bounds the INSERT itself: a connect that succeeds but then hangs (lock
// contention, a stalled network after connect) must not be able to block indefinitely —
// that would violate the same "never block an eval run" guarantee the connect timeout
// exists for.
const CONNECT_TIMEOUT_MS = 250;
const QUERY_TIMEOUT_MS = 2000;

function isDirtyWorkingTree(): boolean {
  try {
    // `git status --porcelain` (not `git diff --quiet`) so a brand-new *untracked* file
    // (e.g. a new eval dataset) counts as dirty too — `git diff --quiet` only sees changes
    // to already-tracked paths and would call that case "clean".
    const status = execSync("git status --porcelain", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return status.trim().length > 0;
  } catch {
    return true;
  }
}

/** `git rev-parse --short HEAD`, suffixed `-dirty` when there are uncommitted changes —
 * without this, evaluating an uncommitted prompt edit (the normal pre-commit iteration
 * workflow this feature exists to support) would silently attribute the run to the same
 * commit hash as the last clean run, blending two different prompt versions under one
 * `commit` key in the trend query. */
function getCommitHash(): string {
  try {
    const hash = execSync("git rev-parse --short HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return isDirtyWorkingTree() ? `${hash}-dirty` : hash;
  } catch {
    return "unknown";
  }
}

/** Weighted average of a case's judge dimension scores, using the same
 * weight-falls-back-to-1 formula as runner-core.ts's aggregateResults() `weightedOverall`
 * — so a persisted regression is comparable to what the console summary already reports
 * (e.g. a safety-weighted-2x drop must show up here, not get diluted by an unweighted
 * mean across dimensions). Empty scores (a case that errored before reaching the judge)
 * yield null, not 0 — a null score is distinguishable from a genuine 0/10 in trend
 * queries. Note: diverges from aggregateResults' weightedOverall in one edge case —
 * an all-zero dimensionWeights config yields null here (not 0, as weightedOverall does),
 * since "no score" is the more honest signal than a fabricated 0; only reachable via a
 * deliberately misconfigured all-zero weights map, so low practical impact. */
function weightedCaseScore(
  rubricScores: RubricScore[],
  dimensionWeights: Record<string, number>,
): number | null {
  if (rubricScores.length === 0) return null;
  let weightedSum = 0;
  let weightTotal = 0;
  for (const s of rubricScores) {
    const weight = dimensionWeights[s.dimension] ?? 1;
    weightedSum += s.score * weight;
    weightTotal += weight;
  }
  return weightTotal > 0 ? weightedSum / weightTotal : null;
}

/** sha256 of the service's raw response text, so a later query can tell "the response is
 * byte-identical across runs but scored differently" (pure judge drift) apart from "the
 * response actually changed" (a real prompt/service regression) — the distinction the
 * ledger's `notes` column alone cannot make. */
function hashOutput(output: string): string {
  return createHash("sha256").update(output).digest("hex");
}

/** Strip a `EVAL_SAMPLES_PER_CASE > 1` sample suffix (`${id}#${n}`, set in
 * runner-core.ts's evaluateCase) back to the base test-case id. Without this, each
 * sample of one logical case would land under its own `case_id` and fragment the
 * per-case trend line eval-report.sh computes — and if the sample count ever changes
 * between runs, the suffixed and unsuffixed rows would never reconcile under the same
 * key. Rows are still one-per-case-sample (multiple samples of one case in one run
 * produce multiple rows sharing the same case_id) — only the fragmenting suffix is
 * removed, letting the report's own `AVG(score) ... GROUP BY case_id` do the sample
 * averaging per commit. */
function baseCaseId(testCaseId: string): string {
  return testCaseId.replace(/#\d+$/, "");
}

/**
 * Append one row per case-sample from this eval run to `dev.eval_results` in the
 * `ocrecipes_lab` lab database. Exported for both production use (runner-core.ts) and
 * test mocking. Fail-silent throughout (connect failure, missing table, query error) —
 * persistence must never block, slow, or fail an eval run — and has no return value a
 * caller could branch on, so eval-run behavior can never accidentally come to depend on
 * persistence succeeding.
 */
export async function persistResults(
  runResult: EvalRunResult,
  suiteName: string,
  dimensionWeights: Record<string, number>,
): Promise<void> {
  if (runResult.cases.length === 0) return;

  const connectionString =
    process.env.LAB_DATABASE_URL ?? "postgresql://localhost/ocrecipes_lab";

  // Hard safety rail, matching every sibling PG Lab script (init.sh, codify-neardup.sh,
  // eval-report.sh): never touch a real app database. Unlike those human-invoked scripts
  // (which fail loud), this runs automatically and unattended at the end of every eval
  // invocation, so a misconfigured LAB_DATABASE_URL is treated the same as "DB
  // unreachable" — another silent no-op, not a thrown error. Parsed via `new URL()`
  // (not a raw `split("/").pop()`) so a query string or fragment appended to the URL
  // (e.g. `?sslmode=require`) can't smuggle the real database name past this check.
  let dbName = "";
  try {
    dbName = new URL(connectionString).pathname.replace(/^\//, "");
  } catch {
    return; // Unparseable connection string — treat like any other unreachable-DB case.
  }
  if (dbName === "nutricam" || dbName === "ocrecipes_solutions") {
    return;
  }

  const client = new Client({
    connectionString,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
  });

  try {
    await client.connect();
  } catch {
    return;
  }

  try {
    const commit = getCommitHash();
    const columnsPerRow = 11;
    const values: unknown[] = [];
    const placeholders = runResult.cases.map((c, i) => {
      const base = i * columnsPerRow;
      values.push(
        runResult.runId,
        c.timestamp,
        commit,
        baseCaseId(c.testCaseId),
        suiteName,
        c.judgeModel,
        runResult.samplesPerCase,
        weightedCaseScore(c.rubricScores, dimensionWeights),
        c.assertions.passed,
        JSON.stringify({
          rubricScores: c.rubricScores,
          failures: c.assertions.failures,
        }),
        hashOutput(c.output),
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}::jsonb, $${base + 11})`;
    });

    await client.query(
      `INSERT INTO dev.eval_results
         (run_id, ts, commit, case_id, service, judge_model, samples, score, pass, notes, output_hash)
       VALUES ${placeholders.join(", ")}`,
      values,
    );
  } catch {
    // Includes "relation dev.eval_results does not exist" when the schema file hasn't been
    // applied yet — treated the same as DB-unreachable per the fail-silent rail.
  } finally {
    await client.end().catch(() => {});
  }
}
