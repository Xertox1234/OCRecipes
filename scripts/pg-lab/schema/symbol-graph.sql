-- scripts/pg-lab/schema/symbol-graph.sql
--
-- Schema for the TypeScript module-import/export graph snapshot (PG Lab Batch C).
-- Owned entirely by this item, per the PG Lab design rail "one schema file per item, no
-- shared migration file" (docs/research/2026-07-05-pg-lab-roadmap.md §4).
--
-- All four tables are DERIVED PROJECTIONS of the repo's TypeScript source — never a
-- source of truth, never hand-edited. They are truncated and wholesale-repopulated (the
-- tables and their indexes are never dropped) by `scripts/pg-lab/symbol-graph.ts
-- --rebuild`. Snapshot-only, no incremental mode: a rebuild is a full re-derivation from
-- source, so there is nothing to keep in sync between runs.
--
-- repo.modules   — one row per scanned source file (repo-root-relative path).
-- repo.imports   — one row per import EDGE (from_path -> to_path), `names` is the list of
--                   named bindings imported across that edge (empty array for a dynamic
--                   `import()`/`require()`/`vi.mock()` call whose imported names can't be
--                   statically enumerated from the call site alone — the edge itself is
--                   still recorded so blast-radius/cycle queries see it).
-- repo.exports   — one row per exported declaration, with a ref_count computed by
--                   symbol-graph.ts's two-pass algorithm (see that file's header comment
--                   for why a single cheap pass is not enough: exports consumed only via a
--                   namespace import, e.g. `import * as storage from "./storage"` then
--                   `storage.getUser()`, or exports consumed only within their own file,
--                   would otherwise misreport as ref_count 0).
-- repo.snapshot_meta — singleton row recording the snapshot's git SHA and rebuild time, so
--                   canned-query output can state its own staleness ("Nightly-manual, not
--                   a hook" per the owning todo's Implementation Notes — staleness is
--                   expected and must be visible, not hidden).
--
-- Idempotent: safe to re-run (IF NOT EXISTS everywhere). Also safe to apply standalone,
-- without scripts/pg-lab/init.sh having run first (CREATE SCHEMA is repeated here
-- defensively).

CREATE SCHEMA IF NOT EXISTS repo;

CREATE TABLE IF NOT EXISTS repo.modules (
    path TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS repo.imports (
    id        BIGSERIAL PRIMARY KEY,
    from_path TEXT NOT NULL,
    to_path   TEXT NOT NULL,
    names     TEXT[] NOT NULL DEFAULT '{}'
);

-- Recursive-CTE traversal (blast radius, cycles) walks this edge table repeatedly in both
-- directions — index both endpoints.
CREATE INDEX IF NOT EXISTS imports_from_path_idx ON repo.imports (from_path);
CREATE INDEX IF NOT EXISTS imports_to_path_idx ON repo.imports (to_path);

CREATE TABLE IF NOT EXISTS repo.exports (
    path      TEXT NOT NULL,
    name      TEXT NOT NULL,
    ref_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (path, name)
);

-- dead-exports filters on ref_count = 0 across the whole table — index it.
CREATE INDEX IF NOT EXISTS exports_ref_count_idx ON repo.exports (ref_count);

CREATE TABLE IF NOT EXISTS repo.snapshot_meta (
    id         BOOLEAN PRIMARY KEY DEFAULT true,
    sha        TEXT,
    rebuilt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT snapshot_meta_singleton CHECK (id)
);
