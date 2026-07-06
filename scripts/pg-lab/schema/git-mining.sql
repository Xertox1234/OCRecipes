-- scripts/pg-lab/schema/git-mining.sql
--
-- Schema for git history mining (PG Lab Batch C — churn hotspots and co-change coupling).
-- Owned entirely by this item, per the PG Lab design rail "one schema file per item, no
-- shared migration file" (docs/research/2026-07-05-pg-lab-roadmap.md §4).
--
-- repo.commits / repo.file_changes are a DERIVED PROJECTION of this repo's own git log —
-- never a source of truth, never hand-edited. `scripts/pg-lab/git-mine.sh --rebuild`
-- truncates and wholesale-reimports both tables from `git log --numstat`; `--import` does
-- an incremental append from `repo.import_cursor.last_sha` (one-way derivation; no parity
-- checking).
--
-- v1 does NOT follow renames: `git-mine.sh` invokes `git log --no-renames --numstat`, so a
-- renamed file appears as an unrelated delete (old path) + add (new path) rather than a
-- linked identity. Documented loudly here and in the todo's Updates/report — monorepo path
-- moves (the 2026 route/storage domain splits) fragment co-change identity across the
-- rename boundary. A future v2 could add `-M` + arrow-path parsing to fix this.
--
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere). Also safe to apply standalone,
-- without scripts/pg-lab/init.sh having run first (CREATE SCHEMA is repeated here
-- defensively). No pg_trgm dependency — unlike codify-neardup.sql, nothing here does
-- similarity search.
--
-- git-mine.sh applies this file on every invocation (import AND query modes) so a fresh
-- ocrecipes_lab works with no separate bootstrap step; every statement below is a silent
-- no-op on repeat application, so client_min_messages is raised past NOTICE to avoid
-- "already exists, skipping" spam on every query-mode call.
SET client_min_messages = warning;

CREATE SCHEMA IF NOT EXISTS repo;

CREATE TABLE IF NOT EXISTS repo.commits (
    sha     TEXT PRIMARY KEY,
    ts      TIMESTAMPTZ NOT NULL,
    author  TEXT NOT NULL,
    subject TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS commits_ts_idx ON repo.commits (ts);

CREATE TABLE IF NOT EXISTS repo.file_changes (
    id         BIGSERIAL PRIMARY KEY,
    sha        TEXT NOT NULL REFERENCES repo.commits (sha) ON DELETE CASCADE,
    path       TEXT NOT NULL,
    additions  INTEGER NOT NULL DEFAULT 0,
    deletions  INTEGER NOT NULL DEFAULT 0,
    is_binary  BOOLEAN NOT NULL DEFAULT false,
    UNIQUE (sha, path)
);

CREATE INDEX IF NOT EXISTS file_changes_path_idx ON repo.file_changes (path);

-- Singleton resume-point for `--import`: the sha of the newest commit seen by the most
-- recent import run (real or fixture). `id` is always `true` — the boolean-PK-with-CHECK
-- trick enforces at most one row. `--rebuild` truncates this alongside the two tables
-- above; `--import` upserts it after a successful load.
CREATE TABLE IF NOT EXISTS repo.import_cursor (
    id          BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
    last_sha    TEXT NOT NULL,
    imported_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Co-change pairs, unordered (path_a < path_b so each pair appears once), with the raw
-- support count (number of commits touching BOTH paths). A VIEW, not a materialized table,
-- so confidence/support thresholds stay query-time (implementation notes) — this repo's
-- commit count (~1800) makes a live self-join trivially fast; no materialization needed.
-- Scaling note: the self-join is O(n²) in per-commit file count, so one anomalous
-- repo-wide commit (mass reformat/lint-fix touching hundreds of files) could emit tens of
-- thousands of pairs from a single commit. Not observed as a problem against this repo's
-- real history (~1800 commits, ~13k pairs total) — revisit (materialize, or cap per-commit
-- file count) only if such a commit lands and `coupled`/ad-hoc queries measurably slow.
CREATE OR REPLACE VIEW repo.co_change_pairs AS
SELECT
    a.path AS path_a,
    b.path AS path_b,
    count(DISTINCT a.sha)::int AS support
FROM repo.file_changes a
JOIN repo.file_changes b
    ON a.sha = b.sha
   AND a.path < b.path
GROUP BY a.path, b.path;

-- Per-file commit counts, used to turn `coupled <path>`'s support into a confidence
-- percentage (support / commits-touching-path-a).
CREATE OR REPLACE VIEW repo.file_commit_counts AS
SELECT path, count(DISTINCT sha)::int AS commits
FROM repo.file_changes
GROUP BY path;
