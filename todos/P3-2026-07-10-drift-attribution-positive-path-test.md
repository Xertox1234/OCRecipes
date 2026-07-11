<!-- Filename: P3-2026-07-10-drift-attribution-positive-path-test.md -->

---

title: "Add positive-path integration test for drift-detect registry attribution"
status: backlog
priority: low
created: 2026-07-10
updated: 2026-07-10
assignee:
labels: [deferred, harness, pg-lab, testing]
github_issue:

---

# Add positive-path integration test for drift-detect registry attribution

## Summary

`.claude/hooks/test-drift-detect.sh` covers only the NEGATIVE attribution case
(unreachable lab DB → drift message carries no `Attribution:` suffix). The positive
path — DB up, another live session registered at the same repo_root, drift message
gets the attribution suffix appended through `drift-detect.sh`'s `MSG="$MSG $ATTRIB"`
line — has no automated regression test. Deleting the whole attribution block from
`drift-detect.sh` would pass CI today.

## Background

Deferred from PR #572's final whole-branch review (session-coordination read path,
2026-07-10). The attribution logic itself IS unit-tested (`test-session-coord.sh`
covers `attribute-drift`'s three outcomes: attributed / own-op / PG-down), and the
integration path was observed live three times during that branch's own development.
The gap is purely drift-detect.sh-side integration regression coverage.

Why it was deferred: `test-drift-detect.sh` is deliberately hermetic (git + jq only,
no DB); the positive path needs a seeded `harness.session_registry` row, i.e. the
throwaway-DB harness from `test-session-coord.sh`. The PR-2 fixture already symlinks
the real `scripts/pg-lab` into the drift fixture repo, so the wiring exists.

## Acceptance Criteria

- [ ] `test-drift-detect.sh` (or a new DB-gated section within it) gains a case where:
      a throwaway lab DB is seeded with another live session at the fixture repo's
      root, a drift is triggered, and the hook's output is asserted to contain
      `Attribution: session` naming that other session.
- [ ] The case skips cleanly (exit 0) when psql or a live local Postgres is missing —
      CI's Lint job has no Postgres service.
- [ ] Fixture identifiers are `$$`-scoped (no cross-run /tmp or DB-name collisions).
- [ ] A mutation check is recorded in the PR: deleting the attribution block from
      `drift-detect.sh` makes the new case FAIL.

## Implementation Notes

- Follow `test-session-coord.sh`'s skeleton: `command -v psql` gate → live-Postgres
  gate → `pg_lab_*_test_$$` throwaway DB via `scripts/pg-lab/init.sh` + schema apply.
- The fixture repo's `repo_root` for the seeded row must be the RESOLVED path
  (`git -C <fixture> rev-parse --show-toplevel`) — macOS canonicalizes `/tmp` to
  `/private/tmp`, and `attribute-drift` joins on exact `repo_root` equality.
- `LAB_DATABASE_URL` must point at the throwaway DB for the hook invocation.
- Attribution output format is pinned in `scripts/pg-lab/session-coord.sh`
  `do_attribute_drift` (`Attribution: session <id8> (<kind>, branch <b>) ...`).

## Dependencies

- None — PRs #571–#573 all merged.

## Updates

### 2026-07-10

- Filed at session-coordination close-out (Task 11) per PR #572 final-review triage.
