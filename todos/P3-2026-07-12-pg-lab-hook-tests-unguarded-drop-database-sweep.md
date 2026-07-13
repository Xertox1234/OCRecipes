---
title: "Apply the WITH (FORCE) throwaway-DB drop fix to the remaining pg-lab hook self-tests"
status: backlog
priority: low
created: 2026-07-12
updated: 2026-07-12
pr: https://github.com/Xertox1234/OCRecipes/pull/608
assignee:
labels: [deferred, pg-lab, testing]
github_issue:
---

# Apply the WITH (FORCE) throwaway-DB drop fix to the remaining pg-lab hook self-tests

## Summary

`P3-2026-07-12-pg-lab-throwaway-db-drop-force` fixed the unguarded
`psql -d postgres -c "DROP DATABASE IF EXISTS ..." >/dev/null 2>&1` cleanup pattern in
`.claude/hooks/test-drift-detect.sh` and `.claude/hooks/test-session-coord.sh` by adding
`WITH (FORCE)`. The identical unguarded pattern still exists in ~10 sibling hook self-test
files — apply the same one-line fix there for consistency and defensive hardening.

## Background

Empirically verified during the parent todo: on local PG18, a plain (non-FORCE)
`DROP DATABASE` against a database with an active connection does not fail fast — it
blocks for the connection's remaining lifetime and, if that exceeds Postgres's internal
retry window, gives up and leaves the database in place (the actual leak). `WITH (FORCE)`
(PG13+) terminates other connections and drops immediately.

Code review of the parent todo's PR narrowed the risk per file:

- **Confirmed same race** (backgrounds a write to its own throwaway DB, exactly like
  `do_attribute_drift`'s `log_event ... &`): the hook under test at `.claude/hooks/inject-patterns.sh:392`
  (`{ printf '%s' "$LOG_TSV" | bash "$LOG_SCRIPT" ...; } &`, exercised by
  `.claude/hooks/test-inject-patterns.sh`, cleanup at :527) and
  `.claude/hooks/session-recent-issues.sh:85` (`{ printf '%s\n' "$LOG_LINE" | bash
"$LOG_SCRIPT" ...; } &`, exercised by `.claude/hooks/test-session-recent-issues.sh`, cleanup
  at :110) — both write to their test's `$LOG_TEST_DB` via `log-injection.sh` the same way
  session-coord.sh's log_event does. These two carry the same demonstrated leak risk the
  parent todo fixed elsewhere.
- **Generic pattern only, not a demonstrated race** (reviewed and confirmed no internal
  backgrounding in either the test file or `log-injection.sh`): the remaining ~8 files
  (`test-db-serial-lock.sh`, `test-pg-lab-codify-neardup.sh`, `test-pg-lab-contract-diff.sh`,
  `test-pg-lab-distill.sh`, `test-pg-lab-git-mine.sh`, `test-pg-lab-log-injection.sh`,
  `test-pg-lab-symbol-graph.sh`, `test-pg-lab-transcripts.sh`). Fixing these is defensive
  hardening against the same class of race, not a confirmed active bug in each file
  individually.

## Acceptance Criteria

- [x] Add `WITH (FORCE)` to the `DROP DATABASE IF EXISTS "$DB"` cleanup call in each of:
      `.claude/hooks/test-db-serial-lock.sh`, `.claude/hooks/test-inject-patterns.sh`,
      `.claude/hooks/test-pg-lab-codify-neardup.sh`, `.claude/hooks/test-pg-lab-contract-diff.sh`,
      `.claude/hooks/test-pg-lab-distill.sh` (two call sites — both `DROP DATABASE` lines),
      `.claude/hooks/test-pg-lab-git-mine.sh`, `.claude/hooks/test-pg-lab-log-injection.sh`,
      `.claude/hooks/test-pg-lab-symbol-graph.sh`, `.claude/hooks/test-pg-lab-transcripts.sh`,
      `.claude/hooks/test-session-recent-issues.sh`.
- [x] Re-run each modified hook test script directly (`bash .claude/hooks/test-*.sh`) and
      confirm it still passes (or cleanly skips when Postgres/psql is unavailable).

## Implementation Notes

- Same one-line change pattern as the parent todo:
  `DROP DATABASE IF EXISTS "$DB"` → `DROP DATABASE IF EXISTS "$DB" WITH (FORCE)`.
- `.claude/hooks/test-pg-lab-distill.sh` has two separate `DROP DATABASE` call sites (a
  `cleanup()` trap and a standalone drop near the end of the file) — fix both.
- No new regression test is required here; the parent todo's
  `.claude/hooks/test-session-coord.sh` test already proves the `WITH (FORCE)` mechanism
  works. This todo is purely about applying the same guard consistently.

## Dependencies

None (the parent todo, `P3-2026-07-12-pg-lab-throwaway-db-drop-force`, is archived once its
PR merges — no blocking relationship, just prior art to follow).

## Risks

Low — dev/CI-only throwaway DBs, `$$`-scoped names avoid cross-run collisions; this is a
hygiene/consistency fix, not a correctness fix for any currently-observed failure.

## Updates

### 2026-07-12

- Filed during execution of `P3-2026-07-12-pg-lab-throwaway-db-drop-force` — code review
  and implementation confirmed the same unguarded pattern recurs in ~10 sibling hook
  self-test files that were out of scope for that todo.
- Implemented on branch `todo/pg-lab-drop-database-force-sweep`: `WITH (FORCE)` added at
  all 11 call sites across the 10 listed files. All 10 modified scripts re-run individually
  and pass (exit 0, full suite executed — psql/PG18 reachable, not the skip path). Sanity
  grep confirms zero remaining unguarded `DROP DATABASE IF EXISTS` lines under
  `.claude/hooks/test-*.sh`. `npm run preflight:fast` passed (stamp for commit `7eab8923`
  clobbered once by a concurrent worktree session's own preflight run — known, documented
  last-writer-wins residual in `scripts/lib/preflight-stamp-path.sh`; re-ran to re-stamp).
  Opened PR #608. **Not guard-eligible for auto-merge** — `scripts/todo-automerge-guard.sh 608`
  returns HOLD (no archived-todo file in the diff, and separately `.claude/hooks/` is not on
  the guard's `SAFE_ALLOWLIST` regardless) — needs individual human review/merge. Status
  stays `backlog` and this file stays un-archived until the PR actually merges.
