<!-- Filename: P3-2026-07-05-pg-flake-ledger.md -->

---

title: "PG Lab: flaky-test & timing ledger via custom Vitest reporter"
status: backlog
priority: low
created: 2026-07-05
updated: 2026-07-05
assignee:
labels: [deferred, testing]
github_issue:

---

# PG Lab: flaky-test & timing ledger via custom Vitest reporter

## Summary

Append per-test outcomes (name, file, duration, attempt count, pass/fail, commit, timestamp) to `dev.test_runs` in `ocrecipes_lab` via a custom Vitest reporter, so retry consumption and timing drift become queryable trends instead of anecdotes.

## Background

Master plan: `docs/research/2026-07-05-pg-lab-roadmap.md`. Suite flakiness was resolved with `retry:2` (project_test_suite_flakiness memory) — but nothing now measures which tests actually consume retries or whether they're getting worse. Separately, `todos/P3-2026-07-03-inject-patterns-defer-before-build.md`-adjacent backlog item #506 flagged the fragile itest-defer api-test margin; a timing series would show whether that margin is drifting toward failure before it flakes in CI.

## Acceptance Criteria

- [ ] Custom Vitest reporter (`scripts/pg-lab/vitest-flake-reporter.ts`) writes one row per test to `dev.test_runs`; buffered single INSERT at run end (not per-test round trips).
- [ ] Fail-silent: DB unreachable → reporter no-ops with zero console noise and zero effect on exit code. Local runs only — reporter must NOT activate in CI (guard on `CI` env var).
- [ ] Schema file `scripts/pg-lab/schema/flake-ledger.sql` (append-only ledger; no rebuild script needed — events, not a projection).
- [ ] `scripts/pg-lab/flake-report.sh`: top retry-consuming tests over N days; duration trend for a named test (default: the itest-defer api-test).
- [ ] Wired into vitest config behind an env flag or unconditionally-with-fail-silent (implementer's call; document choice).
- [ ] Value probe: after 2 weeks of local runs, `flake-report.sh` must answer "which tests used retries this month" — if the answer is consistently "none," note that in the todo archive as the finding.
- [ ] Tests for the reporter (mock pg client; assert row shape and fail-silent path).

## Implementation Notes

- Vitest reporter API: `onFinished`/`onTestRunEnd` (check the installed Vitest major's reporter interface — do not assume).
- Retry detection: `task.result.retryCount` / task `repeats` — verify against installed version.
- Commit hash: `git rev-parse --short HEAD` once per run.
- Use `pg` (already a server dep) with a 250ms connect timeout so the fail-silent path is fast.

## Dependencies

- `P3-2026-07-05-pg-lab-foundation-codify-near-dup.md` must be MERGED (provides ocrecipes_lab + conventions).

## Risks

- Reporter overhead on the hot dev loop — buffer rows, single flush; measure before/after `npm run test:run` wall time.
- Vitest reporter API churn across majors; pin to the interface actually installed.

## Updates

### 2026-07-05

- Initial creation from PG Lab roadmap (Batch B).
