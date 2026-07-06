-- scripts/pg-lab/schema/api-cache.sql
--
-- Schema for the dev-only record/replay cache in front of external
-- nutrition/recipe APIs (CNF, USDA, API Ninjas, Spoonacular) — PG Lab Batch B.
-- Owned entirely by this item, per the PG Lab design rail "one schema file
-- per item, no shared migration file" (docs/research/2026-07-05-pg-lab-roadmap.md §4).
--
-- dev.api_cache is the cache itself: one row per (api, request_hash), storing
-- the recorded JSON response so server/services/dev-api-cache.ts can replay
-- it without calling the real API. A row is inserted on a miss and
-- overwritten (never re-inserted) on `API_CACHE=refresh` — see the
-- ON CONFLICT (api, request_hash) DO UPDATE upsert in that module.
--
-- dev.api_cache_log is an APPEND-ONLY value-probe ledger, mirroring
-- harness.codify_neardup_log's pattern from the PG Lab foundation: one row
-- per cachedFetch() invocation that reached replay/refresh mode, recording
-- whether it was a hit or a miss. scripts/pg-lab/api-cache-report.sh
-- aggregates this into hit/miss counts per API over N days. Prune date: if
-- the hit rate is negligible by 2026-10-01, remove the wrapper (see the
-- todo's Acceptance Criteria).
--
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere). Also safe to apply
-- standalone, without scripts/pg-lab/init.sh having run first (CREATE SCHEMA
-- is repeated here defensively).

CREATE SCHEMA IF NOT EXISTS dev;

CREATE TABLE IF NOT EXISTS dev.api_cache (
    id              BIGSERIAL PRIMARY KEY,
    api             TEXT NOT NULL,
    request_hash    TEXT NOT NULL,
    request_summary TEXT NOT NULL DEFAULT '',
    response        JSONB NOT NULL,
    status          INTEGER NOT NULL,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS api_cache_api_hash_uniq
    ON dev.api_cache (api, request_hash);

CREATE TABLE IF NOT EXISTS dev.api_cache_log (
    id  BIGSERIAL PRIMARY KEY,
    api TEXT NOT NULL,
    hit BOOLEAN NOT NULL,
    ts  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS api_cache_log_api_ts_idx
    ON dev.api_cache_log (api, ts);
