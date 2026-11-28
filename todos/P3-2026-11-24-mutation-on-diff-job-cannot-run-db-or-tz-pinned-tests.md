---
title: "Mutation-on-diff (advisory) fails on files whose tests need a database or a pinned timezone"
status: backlog
priority: low
created: 2026-11-24
updated: 2026-11-25
assignee:
labels: [deferred, testing]
github_issue:
---

# Mutation-on-diff (advisory) fails on files whose tests need a database or a pinned timezone

## Summary

The advisory `Mutation-on-diff` job fails with "There were failed tests in the initial test
run" for two kinds of changed file, so those PRs get a red advisory check and no mutation
score. The cause is the job's environment, not the PRs.

## Background

Seen twice on 2026-11-24, both on coach chat audit PRs. Deferred because the job is advisory
and both PRs were otherwise green.

- PR #2015 (run 45379270629): the new
  `server/services/__tests__/write-card-save-pool.concurrent.test.ts` needs Postgres. The job
  sets `DATABASE_URL` to `localhost:5432/ocrecipes_test` but nothing listens there:
  `connect ECONNREFUSED ::1:5432`.
- PR #2019 (run 45403659779): mutating `server/services/coach-context-builder.ts` runs
  `server/services/__tests__/coach-context-builder.test.ts`, whose test "pins the process
  timezone this file claims (guards the mechanism)" fails under Stryker:
  `expected -0 to be 120`. The timezone pin the file relies on does not reach Stryker's test
  runner processes.

## Acceptance Criteria

- [ ] The job either has a Postgres service, or skips (not fails) tests that need one.
- [x] The timezone pin used by `coach-context-builder.test.ts` holds inside Stryker's
      runner, or that test is excluded from the mutation run. (Done in #2044, 2026-11-25:
      the Stryker vitest runner now uses the `forks` pool. Shown locally; not yet seen in CI.)
- [ ] A PR touching each of the two files above gets a mutation score instead of a
      "failed tests in the initial test run" error.

## Implementation Notes

- Workflow: `.github/workflows/mutation-on-diff.yml` (job "Mutation-on-diff (advisory)",
  `DATABASE_URL` at line 83; no `services:` block was found for it).
- Check how the unit-test jobs in the main CI workflow provide Postgres and the `TZ` value,
  and how the timezone test pins its zone (env `TZ` vs a vitest setup file), before choosing
  a fix.
- The job is advisory: do not make it required as part of this.
