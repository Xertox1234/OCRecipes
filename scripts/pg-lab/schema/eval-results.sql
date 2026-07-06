-- scripts/pg-lab/schema/eval-results.sql
--
-- Schema for the eval-results time series (PG Lab Batch B — see
-- docs/research/2026-07-05-pg-lab-roadmap.md §4). Owned entirely by this item, per the
-- PG Lab design rail "one schema file per item, no shared migration file".
--
-- dev.eval_results is an APPEND-ONLY event ledger: one row per case-sample per eval run
-- (evals/runner.ts and its sibling suite runners, via evals/lib/runner-core.ts's
-- runEvalSuite -> evals/lib/eval-results-store.ts's persistResults()). Never a source of
-- truth, never hand-edited, never truncated or rebuilt — a run's history IS the data.
--
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere). Also safe to apply standalone,
-- without scripts/pg-lab/init.sh having run first (CREATE SCHEMA is repeated here
-- defensively, matching the codify-neardup.sql precedent).
--
-- Bootstrap note: the writer (persistResults) is fail-silent by design (PG Lab rail:
-- "Postgres down or ocrecipes_lab missing -> no-op instantly") and deliberately never
-- creates this table itself — a missing table is treated the same as "DB unreachable".
-- Apply this file once (directly, or via the first `scripts/pg-lab/eval-report.sh` run,
-- which applies it defensively) before eval runs will actually persist rows.

CREATE SCHEMA IF NOT EXISTS dev;

CREATE TABLE IF NOT EXISTS dev.eval_results (
    id          BIGSERIAL PRIMARY KEY,
    run_id      TEXT NOT NULL,
    ts          TIMESTAMPTZ NOT NULL,
    commit      TEXT NOT NULL,
    case_id     TEXT NOT NULL,
    service     TEXT NOT NULL,
    judge_model TEXT NOT NULL,
    samples     INTEGER NOT NULL,
    score       REAL,
    pass        BOOLEAN NOT NULL,
    notes       JSONB
);

-- output_hash is a column added after this table's initial creation. `CREATE TABLE IF NOT
-- EXISTS` alone is a no-op against an already-existing table from an earlier version of
-- this file, so it would never gain the column — and persistResults' fail-silent `catch`
-- would then silently swallow the resulting "column does not exist" error on every future
-- INSERT, permanently and invisibly disabling persistence. An explicit, idempotent ALTER
-- keeps an already-bootstrapped installation in sync. sha256 of the service's raw response
-- text: lets a later query distinguish "the response is byte-identical across runs but
-- scored differently" (pure judge drift) from "the response actually changed" (a real
-- prompt/service regression) — a distinction the score/notes columns alone cannot make.
ALTER TABLE dev.eval_results ADD COLUMN IF NOT EXISTS output_hash TEXT;

-- Primary access pattern for eval-report.sh: trend for one (service, case_id) ordered by
-- time across commits.
CREATE INDEX IF NOT EXISTS eval_results_service_case_ts_idx
    ON dev.eval_results (service, case_id, ts);

CREATE INDEX IF NOT EXISTS eval_results_commit_idx
    ON dev.eval_results (commit);
