---
title: "pg-lab test hooks' throwaway-DB cleanup can silently leak on an orphaned connection"
status: done
priority: low
created: 2026-07-12
updated: 2026-07-12
assignee:
labels: [deferred, pg-lab, testing]
github_issue:
---

# pg-lab test hooks' throwaway-DB cleanup can silently leak on an orphaned connection

## Summary

`cleanup()` in both `.claude/hooks/test-drift-detect.sh` and
`.claude/hooks/test-session-coord.sh` drops their throwaway Postgres DB with an unguarded
`psql -d postgres -c "DROP DATABASE IF EXISTS ..." >/dev/null 2>&1`. If a backgrounded
connection to that DB is still open when cleanup runs (e.g. a detached `log_event ... &`
write in `do_attribute_drift`), Postgres refuses the drop, the `2>&1` swallows the error,
and the throwaway DB leaks silently — an intermittent, timing-dependent failure mode.

## Background

Surfaced during code review of PR #590 (positive-path drift-attribution test). The
reviewer's verdict was MERGE-READY because this matches an existing, pre-existing pattern
in `test-session-coord.sh` rather than being a regression introduced by that PR — but the
underlying gap is real and affects both files.

## Acceptance Criteria

- [x] `DROP DATABASE IF EXISTS "$DB" WITH (FORCE)` (PG13+, matches local dev Postgres) or an
      explicit `pg_terminate_backend` sweep on `datname = '$DB'` before the drop, in both
      `.claude/hooks/test-drift-detect.sh` and `.claude/hooks/test-session-coord.sh`.
- [x] Verify no throwaway DB is left behind after a run where the backgrounded write is
      still in flight at cleanup time (may need an artificial delay to reproduce reliably).

## Implementation Notes

- `.claude/hooks/test-drift-detect.sh:22` — `cleanup()`'s `DROP DATABASE` call (function opens at line 18)
- `.claude/hooks/test-session-coord.sh:103` — `cleanup()` (same pattern, older)
- `scripts/pg-lab/session-coord.sh:257` — `do_attribute_drift`'s backgrounded `log_event ... &`
  is the specific connection that can outlive the test and hold the drop open.

## Dependencies

None.

## Risks

Low — dev/CI-only throwaway DBs, `$$`-scoped names avoid cross-run collisions even when a
leak occurs; this is a hygiene fix, not a correctness fix.

## Updates

### 2026-07-12

- Filed from code review of PR #590 during the "review, fix, codify, close all open PRs" session.

### 2026-07-12 (execution)

- Added `WITH (FORCE)` to the `DROP DATABASE IF EXISTS` cleanup call in both
  `.claude/hooks/test-drift-detect.sh` and `.claude/hooks/test-session-coord.sh`.
- Added a regression test to `test-session-coord.sh` that opens a deliberately slow
  backgrounded connection to the throwaway test DB, then confirms `DROP DATABASE ...
WITH (FORCE)` drops it in well under the connection's lifetime. Manually verified the
  test goes RED (11s, DB left behind) without the fix and GREEN (0-3s, DB gone) with it —
  on local PG18 a plain `DROP DATABASE` against an active connection blocks for the
  connection's remaining lifetime rather than failing fast, and gives up (leaving the DB
  in place) once its internal retry window expires — confirming the todo's premise.
  `bash .claude/hooks/test-drift-detect.sh` (23/23) and `bash .claude/hooks/test-session-coord.sh`
  (ALL PASS) both verified directly, since the standard `npm run test:run`/`check:types`/`lint`
  triad does not exercise `.sh` files.
- Code review (code-reviewer) found the identical unguarded pattern also recurs in
  `.claude/hooks/test-inject-patterns.sh` and `.claude/hooks/test-session-recent-issues.sh`
  (same demonstrated race — both background a write to their own throwaway DB) plus ~8
  other pg-lab hook self-test files (generic pattern, not demonstrated) — filed as
  `todos/P3-2026-07-12-pg-lab-hook-tests-unguarded-drop-database-sweep.md`.
