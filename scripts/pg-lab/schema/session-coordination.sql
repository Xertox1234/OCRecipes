-- scripts/pg-lab/schema/session-coordination.sql
--
-- Schema for cross-terminal session coordination (PG Lab Phase D) — spec:
-- docs/superpowers/specs/2026-07-10-pg-session-coordination-design.md (local-only).
--
-- session_registry and files_in_flight are EPHEMERAL lease tables (TTL 10 min,
-- reap-on-read): drop them mid-session and they repopulate within one heartbeat.
-- Nothing durable may ever read them. coordination_log is the ONLY durable table —
-- an APPEND-ONLY event ledger feeding the ~60-day value probe (spec §10).
--
-- Idempotent: safe to re-run. Safe to apply standalone, without init.sh having run
-- first (CREATE SCHEMA repeated here defensively).

CREATE SCHEMA IF NOT EXISTS harness;

CREATE TABLE IF NOT EXISTS harness.session_registry (
    session_id    TEXT PRIMARY KEY,
    pid           INTEGER,
    repo_root     TEXT NOT NULL,
    branch        TEXT,
    head_sha      TEXT,
    session_kind  TEXT NOT NULL DEFAULT 'unknown',
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + interval '10 minutes'
);

-- Reap-on-read: every refresh-snapshot/reap DELETEs by this predicate first.
CREATE INDEX IF NOT EXISTS session_registry_expires_idx ON harness.session_registry (expires_at);

CREATE TABLE IF NOT EXISTS harness.files_in_flight (
    session_id   TEXT NOT NULL REFERENCES harness.session_registry(session_id) ON DELETE CASCADE,
    abs_path     TEXT NOT NULL,
    rel_path     TEXT NOT NULL,
    first_touch  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_touch   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (session_id, abs_path)
);

-- Cross-worktree comparison (spec §6 level 2) groups by rel_path.
CREATE INDEX IF NOT EXISTS files_in_flight_rel_idx ON harness.files_in_flight (rel_path);

CREATE TABLE IF NOT EXISTS harness.coordination_log (
    id            BIGSERIAL PRIMARY KEY,
    ts            TIMESTAMPTZ NOT NULL DEFAULT now(),
    event         TEXT NOT NULL, -- warn-collision | warn-worktree | drift-attributed |
                                 -- drift-unattributed | lock-acquired | lock-waited |
                                 -- lock-timeout | lock-released | lock-orphan-released
    session_id    TEXT,
    other_session TEXT,
    detail        JSONB
);

CREATE INDEX IF NOT EXISTS coordination_log_ts_idx ON harness.coordination_log (ts);
CREATE INDEX IF NOT EXISTS coordination_log_event_idx ON harness.coordination_log (event);
