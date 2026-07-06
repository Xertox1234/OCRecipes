-- scripts/pg-lab/schema/flake-ledger.sql
--
-- Schema for the flaky-test & timing ledger (PG Lab Batch B — see
-- docs/research/2026-07-05-pg-lab-roadmap.md §4). Owned entirely by this item, per the PG
-- Lab design rail "one schema file per item, no shared migration file".
--
-- dev.test_runs is an APPEND-ONLY event ledger: one row per test case per local Vitest
-- run (scripts/pg-lab/vitest-flake-reporter.ts's FlakeLedgerReporter, wired into
-- vitest.config.ts's `reporters` array for local (non-CI) runs only). Never a source of
-- truth, never hand-edited, never truncated or rebuilt — a run's history IS the data.
--
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere). Also safe to apply standalone,
-- without scripts/pg-lab/init.sh having run first (CREATE SCHEMA is repeated here
-- defensively, matching the codify-neardup.sql / eval-results.sql precedent).
--
-- Bootstrap note: the writer (persistTestRuns in vitest-flake-reporter.ts) is fail-silent
-- by design (PG Lab rail: "Postgres down or ocrecipes_lab missing -> no-op instantly") and
-- deliberately never creates this table itself — a missing table is treated the same as
-- "DB unreachable". Apply this file once (directly, or via the first
-- `scripts/pg-lab/flake-report.sh` run, which applies it defensively) before local test
-- runs will actually persist rows.

CREATE SCHEMA IF NOT EXISTS dev;

CREATE TABLE IF NOT EXISTS dev.test_runs (
    id          BIGSERIAL PRIMARY KEY,
    ts          TIMESTAMPTZ NOT NULL,
    commit      TEXT NOT NULL,
    test_name   TEXT NOT NULL,
    file        TEXT NOT NULL,
    duration_ms REAL NOT NULL CHECK (duration_ms >= 0),
    -- Number of RETRIES beyond the first attempt (Vitest's diagnostic().retryCount) —
    -- total attempts = retry_count + 1. A test with retry_count = 0 passed or failed on
    -- its first try; the project's global `retry: 2` (vitest.config.ts) caps this at 2.
    retry_count INTEGER NOT NULL CHECK (retry_count >= 0),
    -- Vitest's diagnostic().flaky: true only when the test failed at least once but
    -- ultimately passed after a retry — the clearest single "this test IS flaky" signal.
    flaky       BOOLEAN NOT NULL,
    -- Vitest's TestResult.state: 'passed' | 'failed' | 'skipped'.
    state       TEXT NOT NULL
);

-- Primary access patterns for flake-report.sh: retry-consumption ranking over a trailing
-- window, and a duration trend for one named test ordered by time.
CREATE INDEX IF NOT EXISTS test_runs_retry_count_idx
    ON dev.test_runs (retry_count) WHERE retry_count > 0;

CREATE INDEX IF NOT EXISTS test_runs_name_file_ts_idx
    ON dev.test_runs (test_name, file, ts);
