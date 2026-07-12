---
title: "pg-lab test hooks' throwaway-DB cleanup can silently leak on an orphaned connection"
status: backlog
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

- [ ] `DROP DATABASE IF EXISTS "$DB" WITH (FORCE)` (PG13+, matches local dev Postgres) or an
      explicit `pg_terminate_backend` sweep on `datname = '$DB'` before the drop, in both
      `.claude/hooks/test-drift-detect.sh` and `.claude/hooks/test-session-coord.sh`.
- [ ] Verify no throwaway DB is left behind after a run where the backgrounded write is
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
