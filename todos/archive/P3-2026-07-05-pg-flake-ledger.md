<!-- Filename: P3-2026-07-05-pg-flake-ledger.md -->

---

title: "PG Lab: flaky-test & timing ledger via custom Vitest reporter"
status: done
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

- [x] Custom Vitest reporter (`scripts/pg-lab/vitest-flake-reporter.ts`) writes one row per test to `dev.test_runs`; buffered at run end (not per-test round trips) — see Updates for the batched-vs-single-statement deviation.
- [x] Fail-silent: DB unreachable → reporter no-ops with zero console noise and zero effect on exit code. Local runs only — reporter must NOT activate in CI (guard on `CI` env var).
- [x] Schema file `scripts/pg-lab/schema/flake-ledger.sql` (append-only ledger; no rebuild script needed — events, not a projection).
- [x] `scripts/pg-lab/flake-report.sh`: top retry-consuming tests over N days; duration trend for a named test — see Updates for the "itest-defer api-test" default substitution.
- [x] Wired into vitest config behind an env flag or unconditionally-with-fail-silent (implementer's call; document choice) — see Updates.
- [x] Value probe mechanism built and verified end-to-end against a live `ocrecipes_lab`; the 2-week "which tests used retries this month" retrospective itself is necessarily deferred — see Updates.
- [x] Tests for the reporter (mock pg client; assert row shape and fail-silent path) — 13 tests in `scripts/pg-lab/__tests__/vitest-flake-reporter.test.ts`.

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

### 2026-07-06

- Implemented: `scripts/pg-lab/vitest-flake-reporter.ts` (`FlakeLedgerReporter`, a Vitest
  4 `Reporter` using the installed version's `onTestCaseResult`/`onTestRunEnd` reported-
  tasks API — confirmed against the installed `vitest@4.1.7` type declarations, not
  assumed), `scripts/pg-lab/schema/flake-ledger.sql` (`dev.test_runs`, append-only),
  `scripts/pg-lab/flake-report.sh` (retry-consumption ranking + duration trend), and
  `scripts/pg-lab/__tests__/vitest-flake-reporter.test.ts` (13 tests).
- **Deviation — "buffered single INSERT" → chunked batched INSERT.** Code review (two
  independent reviewers) found that one unchunked multi-row INSERT for an entire suite run
  risks exceeding PostgreSQL's 65535-bind-parameter-per-statement cap once the suite grows
  past ~8191 test cases (this repo already has 5000+), which would silently disable the
  entire ledger on exactly the largest runs (swallowed by the fail-silent `catch`) with no
  visibility. Implemented as `ROWS_PER_BATCH = 1000`-row sequential INSERTs within the same
  connect/end lifecycle instead — still one connection and one flush at run end, never a
  per-test round trip, just multiple statements when a run is large. Acceptance criterion
  intent (no per-test round trips, buffered at run end) preserved; literal "single INSERT"
  wording superseded for correctness at scale. Covered by a dedicated regression test.
- **Deviation — no hardcoded "itest-defer api-test" default in `flake-report.sh`.** That
  test is `.claude/hooks/test-inject-patterns.sh`'s `itest-defer` case — a bash-level hook
  test entirely outside Vitest, so this Vitest-only reporter can never populate a row for
  it. `flake-report.sh` therefore has no hardcoded default test name; pass a real Vitest
  test's `fullName` to use the duration-trend mode. Documented in the script's header.
- **Wiring choice**: added unconditionally to `vitest.config.ts`'s `reporters` array,
  gated out entirely by `process.env.CI` at the config level (plus a defense-in-depth
  `process.env.CI` check inside the reporter itself) — not a separate opt-in env flag.
- **Value probe**: the mechanism (reporter → `dev.test_runs` → `flake-report.sh`) is built
  and verified end-to-end against a live local `ocrecipes_lab` (real rows persisted and
  queried back correctly, including the retry/flaky columns). The actual "which tests used
  retries this month" 2-week retrospective this AC asks for cannot be produced today — it
  requires two weeks of accumulated local runs. Revisit around 2026-07-19: run
  `scripts/pg-lab/flake-report.sh` and note the finding here (or in a follow-up), including
  the "consistently none" case as a valid, useful finding per the AC.
- **Review**: 2 rounds (code-reviewer + server-reviewer round 1: 1 CRITICAL — a
  `flake-report.sh` denylist bash suffix-split vulnerable to `?query-string` smuggling past
  the nutricam/ocrecipes_solutions check, fixed by stripping query/fragment before the
  split, verified live; 2 WARNINGs — unbounded INSERT params (see above) and an inaccurate
  `vitest.config.ts` comment, both fixed; several trivial SUGGESTIONs applied. Round 2
  (code-reviewer) confirmed all six fixes sound with no new CRITICAL/WARNING beyond two
  comment-accuracy nits, both fixed.
- Reporter overhead measured: full-suite wall time with the reporter active (34.16s) vs.
  `CI=1` (reporter fully disabled, 34.42s) — no detectable overhead; the reporter's one
  extra DB round trip at run end is negligible against a 30+ second suite.
