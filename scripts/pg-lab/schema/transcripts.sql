-- scripts/pg-lab/schema/transcripts.sql
--
-- Schema for the Claude Code transcript archive (PG Lab Batch B —
-- P3-2026-07-05-pg-transcript-fts.md). Owned entirely by this item, per the PG Lab design
-- rail "one schema file per item, no shared migration file" (docs/research/2026-07-05-pg-lab-roadmap.md §4).
--
-- harness.transcript_messages is a DERIVED PROJECTION of the ~/.claude/projects/*/*.jsonl
-- transcript files on disk — never a source of truth. `scripts/pg-lab/transcripts.sh --import`
-- appends only NEW lines per session (incremental, tracked in transcript_sessions);
-- `--rebuild` truncates both tables below and reimports everything from scratch (the table
-- and its indexes are never dropped, only emptied — same convention as
-- harness.solution_titles in codify-neardup.sql).
--
-- Only user/assistant message TEXT plus tool_use NAMES are ingested — tool_result payloads
-- are deliberately never ingested in v1 (volume + noise; see the todo's Acceptance Criteria).
-- msg_uuid is the JSONL record's own `uuid` field (suffixed `#<block-index>` when one
-- assistant record yields multiple rows, one per content block) — a natural, globally unique
-- key that makes incremental re-import idempotent via ON CONFLICT DO NOTHING, independent of
-- the file-line bookmark in transcript_sessions.
--
-- harness.transcript_sessions is a summary/bookmark table: one row per session_id, tracking
-- the last imported line number of its source .jsonl (so --import only reads new lines).
--
-- harness.transcript_search_log is an APPEND-ONLY value-probe ledger: one row per search
-- invocation (hit or miss), so a later query can tell whether this feature earns its keep.
-- Prune date: if it shows no meaningful usage by 2026-10-01, archive this feature per the
-- todo's Acceptance Criteria and the PG Lab "every feature ships a value probe" rail.
--
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere). Also safe to apply standalone,
-- without scripts/pg-lab/init.sh having run first (CREATE EXTENSION / CREATE SCHEMA are
-- repeated here defensively).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE SCHEMA IF NOT EXISTS harness;

CREATE TABLE IF NOT EXISTS harness.transcript_messages (
    msg_uuid    TEXT PRIMARY KEY,
    session_id  TEXT NOT NULL,
    project_dir TEXT NOT NULL,
    ts          TIMESTAMPTZ,
    role        TEXT NOT NULL,
    content     TEXT NOT NULL,
    tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED
);

-- Accelerates the FTS `@@` match in ts_rank queries.
CREATE INDEX IF NOT EXISTS transcript_messages_tsv_idx
    ON harness.transcript_messages USING gin (tsv);

-- Accelerates the `--fuzzy` pg_trgm `<%` word_similarity filter (word_similarity, not the
-- whole-string similarity()/`%` operator, since content is long free text and a short
-- misremembered query needs "best matching extent within content").
CREATE INDEX IF NOT EXISTS transcript_messages_content_trgm_idx
    ON harness.transcript_messages USING gin (content gin_trgm_ops);

-- Supports the ±1-message-of-context lookup in transcripts.sh's `run_search`: a `hits` CTE
-- filters+ranks+LIMITs first, then two LEFT JOIN LATERAL subqueries per hit seek the
-- preceding/following row within the same session via `(session_id, ts)` — not a full-table
-- LAG/LEAD window, which would materialize every row instead of just the matched ones.
CREATE INDEX IF NOT EXISTS transcript_messages_session_ts_idx
    ON harness.transcript_messages (session_id, ts);

CREATE TABLE IF NOT EXISTS harness.transcript_sessions (
    session_id         TEXT PRIMARY KEY,
    project_dir        TEXT NOT NULL,
    source_file        TEXT NOT NULL,
    last_imported_line INTEGER NOT NULL DEFAULT 0,
    message_count      INTEGER NOT NULL DEFAULT 0,
    first_ts           TIMESTAMPTZ,
    last_ts            TIMESTAMPTZ,
    imported_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS harness.transcript_search_log (
    id           BIGSERIAL PRIMARY KEY,
    ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
    query        TEXT NOT NULL,
    fuzzy        BOOLEAN NOT NULL DEFAULT false,
    result_count INTEGER
);
