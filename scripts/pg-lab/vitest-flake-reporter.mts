// scripts/pg-lab/vitest-flake-reporter.ts
//
// Custom Vitest reporter that appends one row per test case to `dev.test_runs` in the
// `ocrecipes_lab` lab database (PG Lab Batch B — docs/research/2026-07-05-pg-lab-roadmap.md
// §4), so retry consumption and duration drift become queryable trends instead of
// anecdotes (todos/archive/P3-2026-07-05-pg-flake-ledger.md).
//
// Mirrors the same PG Lab TypeScript writer fail-silent shape as the sibling, in-progress
// evals/lib/eval-results-store.ts's persistResults() (todo/P3-2026-07-05-pg-eval-results-
// store — not yet merged as of this writing; see whichever of the two PRs lands first for
// docs/solutions/conventions/pg-lab-fail-silent-typescript-writer-pattern-2026-07-06.md,
// which formalizes it once one of them merges): a one-shot pg.Client (not a Pool — this is
// a once-per-run write), bounded connect + query timeouts, a denylist check against the
// real app databases parsed via new URL().pathname (never a raw string split, which a
// query string could smuggle past), connect/query/end each independently guarded so
// nothing ever throws out of this reporter, and no return value a caller could branch on.
//
// CI guard: local-dev-only (see the todo's Acceptance Criteria). The primary gate is in
// vitest.config.ts, which omits this reporter from the `reporters` array entirely when
// `process.env.CI` is set — that also avoids constructing a `pg.Client` in an environment
// that will never use it. The `process.env.CI` checks in this file are a second,
// defense-in-depth no-op guard in case this class is ever wired some other way.

import { execSync } from "node:child_process";
import pg from "pg";
import type {
  Reporter,
  SerializedError,
  TestCase,
  TestModule,
  TestRunEndReason,
} from "vitest/node";

const { Client } = pg;

const CONNECT_TIMEOUT_MS = 250;
const QUERY_TIMEOUT_MS = 2000;
export const COLUMNS_PER_ROW = 8;
// PostgreSQL's wire protocol hard-caps bind parameters at 65535 per statement. This repo
// already has 5000+ test cases and grows every release, so a single unchunked INSERT for
// the whole run would eventually exceed that cap (at COLUMNS_PER_ROW=8, ~8191 rows) and
// throw — which the fail-silent catch below would then swallow, silently disabling the
// entire ledger on exactly the largest, most-valuable runs. 1000 rows/batch (8000 params)
// keeps generous headroom and still turns "one query per test" into a handful of queries
// per run.
export const ROWS_PER_BATCH = 1000;

export interface TestRunRow {
  testName: string;
  file: string;
  durationMs: number;
  retryCount: number;
  flaky: boolean;
  state: string;
}

function isDirtyWorkingTree(): boolean {
  try {
    // `git status --porcelain` (not `git diff --quiet`) so a brand-new *untracked* file
    // counts as dirty too — `git diff --quiet` only sees changes to already-tracked paths.
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
 * without this, running the suite against an uncommitted change would silently attribute
 * every row to the same commit hash as the last clean run. */
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

/**
 * Append one row per test in `rows` to `dev.test_runs`. Exported for both reporter use
 * and test mocking. Fail-silent throughout (connect failure, missing table, query error)
 * — persistence must never block, slow, log, or affect the Vitest run's exit code — and
 * returns void so no caller can accidentally branch on persistence succeeding.
 */
export async function persistTestRuns(rows: TestRunRow[]): Promise<void> {
  if (rows.length === 0) return;

  const connectionString =
    process.env.LAB_DATABASE_URL ?? "postgresql://localhost/ocrecipes_lab";

  // Hard safety rail, matching every PG Lab writer (init.sh, codify-neardup.sh,
  // eval-results-store.ts): never touch a real app database. Parsed via `new URL()` (not
  // a raw `split("/").pop()`) so a query string (e.g. `?sslmode=require`) can't smuggle
  // the real database name past this check. Runs automatically and unattended at the end
  // of every local test run, so a misconfigured LAB_DATABASE_URL is treated the same as
  // "DB unreachable" — another silent no-op, never a thrown error.
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
    const ts = new Date().toISOString();

    // Chunked into ROWS_PER_BATCH-row batches (see the constant's comment) — still one
    // connection and one flush at run end, just as multiple sequential INSERTs instead of
    // a single statement that could exceed Postgres's bind-parameter limit at scale.
    for (let start = 0; start < rows.length; start += ROWS_PER_BATCH) {
      const batch = rows.slice(start, start + ROWS_PER_BATCH);
      const values: unknown[] = [];
      const placeholders = batch.map((r, i) => {
        const base = i * COLUMNS_PER_ROW;
        values.push(
          ts,
          commit,
          r.testName,
          r.file,
          r.durationMs,
          r.retryCount,
          r.flaky,
          r.state,
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8})`;
      });

      await client.query(
        `INSERT INTO dev.test_runs
           (ts, commit, test_name, file, duration_ms, retry_count, flaky, state)
         VALUES ${placeholders.join(", ")}`,
        values,
      );
    }
  } catch {
    // Includes "relation dev.test_runs does not exist" when the schema file hasn't been
    // applied yet — treated the same as DB-unreachable per the fail-silent rail. Also
    // covers a mid-loop batch failure: any batches already inserted before the failing one
    // stay committed (no transaction wraps the loop, by design — partial persistence of a
    // huge run is strictly better than losing 100% of it to one bad batch).
  } finally {
    await client.end().catch(() => {});
  }
}

/**
 * Buffers one row per test case (onTestCaseResult) and flushes a single buffered INSERT
 * at run end (onTestRunEnd) — never a per-test round trip. Local-dev-only: see the
 * module-level comment for the CI gating strategy.
 */
export class FlakeLedgerReporter implements Reporter {
  private rows: TestRunRow[] = [];

  onTestCaseResult(testCase: TestCase): void {
    if (process.env.CI) return;

    const diagnostic = testCase.diagnostic();
    this.rows.push({
      testName: testCase.fullName,
      file: testCase.module.relativeModuleId,
      durationMs: diagnostic?.duration ?? 0,
      retryCount: diagnostic?.retryCount ?? 0,
      flaky: diagnostic?.flaky ?? false,
      state: testCase.result().state,
    });
  }

  async onTestRunEnd(
    _testModules: readonly TestModule[],
    _unhandledErrors: readonly SerializedError[],
    _reason: TestRunEndReason,
  ): Promise<void> {
    if (process.env.CI) return;
    const rows = this.rows;
    this.rows = [];
    await persistTestRuns(rows);
  }
}
