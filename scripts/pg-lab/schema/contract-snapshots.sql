-- scripts/pg-lab/schema/contract-snapshots.sql
--
-- Schema for the dev-mode API contract snapshot/diff item (PG Lab Batch C). Owned
-- entirely by this item, per the PG Lab design rail "one schema file per item, no
-- shared migration file" (docs/research/2026-07-05-pg-lab-roadmap.md §4).
--
-- dev.contract_snapshots is an APPEND-ish, upserted ledger: one row per distinct
-- (branch, route_pattern, method, status) combination, recording the current
-- structural TYPE SKELETON of that endpoint's JSON response body — keys + primitive
-- types + array-element skeleton, NEVER raw response values (responses can contain
-- user health data; storing values is out of bounds). Written by the dev-only Express
-- middleware in server/lib/contract-snapshot.ts, opt-in via CONTRACT_SNAPSHOT=1.
-- Compared across branches by scripts/pg-lab/contract-diff.sh.
--
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere). Also safe to apply standalone,
-- without scripts/pg-lab/init.sh having run first (CREATE SCHEMA is repeated here
-- defensively).
--
-- No backfill/redaction for rows written before the dynamic-key redaction fix in
-- deriveShape() (server/lib/contract-shape.ts): explicit, deliberate decision, not an
-- oversight — see the DECISION comment above recordSnapshot() in
-- server/lib/contract-snapshot.ts for the full rationale. Every row here is disposable,
-- re-derivable diagnostic data; `TRUNCATE dev.contract_snapshots;` is a safe way to clear
-- stale rows from a local table.

CREATE SCHEMA IF NOT EXISTS dev;

CREATE TABLE IF NOT EXISTS dev.contract_snapshots (
    id            BIGSERIAL PRIMARY KEY,
    branch        TEXT NOT NULL,
    route_pattern TEXT NOT NULL,
    method        TEXT NOT NULL,
    status        INTEGER NOT NULL,
    shape         JSONB NOT NULL,
    first_seen    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen     TIMESTAMPTZ NOT NULL DEFAULT now(),
    sample_count  INTEGER NOT NULL DEFAULT 1,
    UNIQUE (branch, route_pattern, method, status)
);

CREATE INDEX IF NOT EXISTS contract_snapshots_branch_idx
    ON dev.contract_snapshots (branch);
