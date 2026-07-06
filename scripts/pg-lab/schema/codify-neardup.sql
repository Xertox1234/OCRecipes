-- scripts/pg-lab/schema/codify-neardup.sql
--
-- Schema for the /codify pg_trgm near-dup advisory (PG Lab Batch A — the foundation todo).
-- Owned entirely by this item, per the PG Lab design rail "one schema file per item, no
-- shared migration file" (docs/research/2026-07-05-pg-lab-roadmap.md §4).
--
-- harness.solution_titles is a DERIVED PROJECTION of docs/solutions/*.md frontmatter —
-- never a source of truth, never hand-edited. It is truncated and wholesale-repopulated
-- (the table and its indexes are never dropped) by
-- `scripts/pg-lab/codify-neardup.sh --rebuild` (one-way derivation; no parity checking).
--
-- harness.codify_neardup_log is an APPEND-ONLY value-probe ledger: one row per query-mode
-- invocation, so a later query can tell whether the advisory ever fires above threshold.
-- Prune date: if it shows zero useful hits by 2026-10-01, revert the /codify skill edit
-- that invokes codify-neardup.sh (see the todo's Acceptance Criteria).
--
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere). Also safe to apply standalone,
-- without scripts/pg-lab/init.sh having run first (CREATE EXTENSION / CREATE SCHEMA are
-- repeated here defensively).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS harness;

CREATE TABLE IF NOT EXISTS harness.solution_titles (
    path    TEXT PRIMARY KEY,
    title   TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    tags    TEXT NOT NULL DEFAULT '',
    created DATE
);

-- GIN trigram indexes support a future `%` similarity-operator WHERE filter. At the
-- current corpus size (500-1000 rows) the query itself (ORDER BY similarity(...) DESC
-- LIMIT 5) is a trivial sequential scan and does not require these to be fast — they are
-- here so the projection is ready for a `%`-filtered WHERE clause without a follow-up
-- migration. Note for that future change: a GIN trgm index only accelerates the `%`
-- operator in a WHERE clause (row filtering) — it does NOT make `ORDER BY similarity(...)`
-- itself index-backed; that sort still runs post-filter over whatever WHERE `%` left. Only
-- a GiST index with the `<->` distance operator gets KNN-ordered index support, which this
-- corpus is far too small to need.
CREATE INDEX IF NOT EXISTS solution_titles_title_trgm_idx
    ON harness.solution_titles USING gin (title gin_trgm_ops);

CREATE INDEX IF NOT EXISTS solution_titles_summary_trgm_idx
    ON harness.solution_titles USING gin (summary gin_trgm_ops);

CREATE TABLE IF NOT EXISTS harness.codify_neardup_log (
    id        BIGSERIAL PRIMARY KEY,
    ts        TIMESTAMPTZ NOT NULL DEFAULT now(),
    candidate TEXT NOT NULL,
    top_score REAL
);
