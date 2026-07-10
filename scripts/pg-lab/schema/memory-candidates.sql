-- scripts/pg-lab/schema/memory-candidates.sql
--
-- Schema for the episodic-distillation EXPERIMENT (PG Lab Phase D —
-- P3-2026-07-05-pg-episodic-distillation.md; spec:
-- docs/superpowers/specs/2026-07-09-pg-episodic-distillation-design.md). Owned entirely by
-- this item, per the PG Lab "one schema file per item" rail.
--
-- EXPERIMENT-SCOPED: harness.memory_candidates is a working queue (candidates + review
-- status); harness.distill_runs and harness.distilled_sessions are append-only ledgers.
-- None is a source of truth — the canonical stores remain the markdown memory directory and
-- docs/solutions/. All three tables are dropped by hand when the experiment concludes
-- (keep/kill verdict recorded); nothing else may ever read them.
--
-- Cost accounting lives in distill_runs.tokens_in/tokens_out (converted to USD by distill.sh
-- pricing constants) — NOT in the cheap-worker usage.jsonl ledger, which carries no cost
-- field and no purpose tag (inspected 2026-07-09).
--
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere). CREATE EXTENSION / CREATE SCHEMA
-- repeated defensively (same convention as transcripts.sql / codify-neardup.sql).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS harness;

CREATE TABLE IF NOT EXISTS harness.distill_runs (
    id             SERIAL PRIMARY KEY,
    ran_at         TIMESTAMPTZ DEFAULT now(),
    window_start   DATE NOT NULL,
    window_end     DATE NOT NULL,
    sessions_seen  INT NOT NULL DEFAULT 0,
    sessions_sent  INT NOT NULL DEFAULT 0,
    sessions_gated INT NOT NULL DEFAULT 0,
    parse_failures INT NOT NULL DEFAULT 0,
    candidates     INT NOT NULL DEFAULT 0,
    tokens_in      BIGINT NOT NULL DEFAULT 0,
    tokens_out     BIGINT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS harness.distilled_sessions (
    session_id     TEXT PRIMARY KEY,
    run_id         INT NOT NULL REFERENCES harness.distill_runs(id),
    outcome        TEXT NOT NULL CHECK (outcome IN ('sent','gated','parse_failed'))
);

CREATE TABLE IF NOT EXISTS harness.memory_candidates (
    id             SERIAL PRIMARY KEY,
    created_at     TIMESTAMPTZ DEFAULT now(),
    session_id     TEXT NOT NULL,
    source_msgs    TEXT[],
    target_store   TEXT NOT NULL CHECK (target_store IN ('memory','solution')),
    subtype        TEXT NOT NULL,  -- validated by the distill.sh parser (memory: user|feedback|
                                   -- project|reference; solution: '<track>:<category>')
    title          TEXT NOT NULL,
    content        TEXT NOT NULL,
    near_dup_path  TEXT,
    near_dup_score NUMERIC,
    status         TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','accepted','rejected')),
    reviewer_note  TEXT,
    reviewed_at    TIMESTAMPTZ
);
