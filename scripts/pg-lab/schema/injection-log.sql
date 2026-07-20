-- scripts/pg-lab/schema/injection-log.sql
--
-- Schema for pattern-injection usage telemetry (PG Lab Batch C) — logs what
-- .claude/hooks/inject-patterns.sh (PreToolUse) and .claude/hooks/session-recent-issues.sh
-- (SessionStart) actually deliver, so the docs/solutions/ + docs/rules/ corpus can be
-- audited for dead weight (docs never delivered) and over-firing domains (payload bytes,
-- defer frequency) via scripts/pg-lab/injection-report.sh, instead of rotting silently —
-- see docs/research/2026-07-05-pg-lab-roadmap.md R4.
--
-- harness.injection_log is an APPEND-ONLY event ledger — one row per (domain, action)
-- outcome per hook invocation (a single edit touching N domains logs N rows; a
-- SessionStart digest logs one row with domain/edited_path empty). Never a source of
-- truth, never hand-edited, never pruned programmatically.
--
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere). Safe to apply standalone, without
-- scripts/pg-lab/init.sh having run first (CREATE SCHEMA is repeated here defensively).

CREATE SCHEMA IF NOT EXISTS harness;

CREATE TABLE IF NOT EXISTS harness.injection_log (
    id            BIGSERIAL PRIMARY KEY,
    ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
    session_id    TEXT,
    tool          TEXT,
    edited_path   TEXT,
    domain        TEXT,
    doc_paths     TEXT[] NOT NULL DEFAULT '{}',
    action        TEXT NOT NULL,
    payload_bytes INT NOT NULL DEFAULT 0
);

-- Added 2026-07-19: agent_id column — see scripts/pg-lab/log-injection.sh's header for the
-- full wire-format contract (what the field is, and why it's the trailing one).
-- '' (empty string, the single canonical encoding — never NULL) for the top-level context
-- (no agent_id in the hook JSON) or a SessionStart digest, which is always top-level.
-- ALTER-only, deliberately NOT restated in CREATE TABLE above (the eval-results.sql
-- output_hash convention): one declaration site, and the idempotent ALTER serves fresh
-- installs and already-bootstrapped databases identically.
ALTER TABLE harness.injection_log ADD COLUMN IF NOT EXISTS agent_id TEXT;
-- SET DEFAULT must be its own statement: a DEFAULT on the ADD COLUMN line would no-op for
-- any database where the column already exists. The default also normalizes 7-column
-- INSERTs from stale pre-merge checkouts (executor worktrees running their own old
-- log-injection.sh copy) to '' server-side.
ALTER TABLE harness.injection_log ALTER COLUMN agent_id SET DEFAULT '';
-- One-time, idempotent backfill: rows that predate the column (backfilled NULL by ADD
-- COLUMN) join the '' encoding, so agent_id = '' selects ALL top-level rows and re-applying
-- this file self-heals any NULL stragglers.
UPDATE harness.injection_log SET agent_id = '' WHERE agent_id IS NULL;

-- Supports scripts/pg-lab/injection-report.sh's "top domains by payload bytes" and
-- "defer frequency" GROUP BY domain queries.
CREATE INDEX IF NOT EXISTS injection_log_domain_idx ON harness.injection_log (domain);

-- Supports the report's "docs never delivered in N days" query (ts >= now() - interval).
CREATE INDEX IF NOT EXISTS injection_log_ts_idx ON harness.injection_log (ts);

-- Supports unnesting doc_paths to find last-delivery timestamps per doc — a GIN index lets
-- a future `doc_paths @> ARRAY[...]` containment filter use an index instead of a seq scan.
CREATE INDEX IF NOT EXISTS injection_log_doc_paths_gin_idx ON harness.injection_log USING gin (doc_paths);
