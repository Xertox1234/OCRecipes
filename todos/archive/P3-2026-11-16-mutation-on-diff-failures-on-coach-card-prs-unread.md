---
title: "Read the advisory mutation results from the Coach grocery and pantry card PRs"
status: done
priority: low
created: 2026-11-16
updated: 2026-11-19
assignee:
labels: [deferred, testing]
github_issue:
---

# Read the advisory mutation results from the Coach grocery and pantry card PRs

## Summary

The advisory "Mutation-on-diff" check failed on PR 1892 and PR 1897 and nobody read the
results in full. Go through the surviving mutants in the code those PRs changed and add the
tests that would have caught them.

## Background

The check is advisory, so both PRs merged. On PR 1892 the check ran over whole touched files
and the survivors sampled were in lines that PR did not change; the full list was not read.
PR 1897's run (GitHub Actions run `43978622572`, branch `fix/coach-pantry-card-resave`) was
not opened at all. PR 1894 and PR 1895 were not checked either way.

The code in question decides what Coach may add to a grocery list or change in the pantry,
so a weak test there is worth finding.

## Acceptance Criteria

- [x] The mutation reports for PRs 1892, 1894, 1895 and 1897 are read; the PR records, per
      file, how many mutants survived in lines those PRs added or changed.
- [x] Each survivor in `server/services/write-cards/grocery.ts` and
      `server/services/write-cards/pantry.ts` is either killed by a new test or listed with
      the reason it is equivalent.
- [x] If the check failed for a reason other than survivors (time limit, set-up error), that
      is recorded instead, in `docs/harness-residuals.md` if it is a harness defect.

## Implementation Notes

- Read failures with `npm run ci:failed-logs -- <run-id>`; never dump whole workflow logs.
- If the reports have expired, re-run the mutation check locally on the two files.
- Priority cases: the pantry verdict boundaries (covered / unsure / buy), the duplicate skip
  on save, the amount cap, and the "unreadable amount is dropped, never use-all" rule.

## Scope Contract

- **Mechanisms to use:** the existing Stryker set-up; Vitest tests.
- **Files in scope:** `server/services/write-cards/__tests__/**`.
- No new mechanisms, files, or abstractions beyond those listed. Product code changes only if
  a survivor turns out to be a real defect, disclosed in the PR.

## Dependencies

- None.

## Risks

- Run artifacts may have expired; a local re-run takes time.

## Updates

### 2026-11-16

- Initial creation

### 2026-11-19

- Read all four runs. `grocery.ts` and `pantry.ts` were never mutated in CI: on PR 1892 and
  PR 1897 their tests need Postgres and the advisory job has none (`ECONNREFUSED`, "explore
  exited 1"); on PR 1895 both were past the six-file cap in a green run; PR 1894 did not touch
  them. Recorded in `docs/harness-residuals.md`.
- Ran Stryker locally on both files. Before: `grocery.ts` 47 undetected of 203 mutants,
  `pantry.ts` 62 of 310. After the new tests: 1 and 8.
- The 9 left, none killable by a test of behaviour:
  - `grocery.ts:153` the placeholder for "no amount" in the duplicate key: any fixed text gives
    the same keys, because an amount is a number and never equals it.
  - `pantry.ts:62` `n === null`: `null > MAX_AMOUNT` is false, so null is returned either way.
  - `pantry.ts:157` `held === null` and `amount === null`: with no held amount `amount >= null`
    is already true for any amount (amounts are never negative), and an unread amount only
    reaches this line when `all` is true.
  - `pantry.ts:290` and `:342` (two each) the `length > 0` guards: the storage call with an empty
    list changes nothing, so the guard only saves a query.
  - `pantry.ts:317` the fallback for a save with no restore list: the mutant does one extra read
    that finds no row. Not equivalent in the strict sense; nothing a caller can observe.
- Survivors on lines the four PRs changed in the other files (counts only, tests for them are
  outside this todo's scope) are in the PR description.
