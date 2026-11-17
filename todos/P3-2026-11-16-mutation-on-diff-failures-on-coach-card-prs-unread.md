---
title: "Read the advisory mutation results from the Coach grocery and pantry card PRs"
status: backlog
priority: low
created: 2026-11-16
updated: 2026-11-16
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

- [ ] The mutation reports for PRs 1892, 1894, 1895 and 1897 are read; the PR records, per
      file, how many mutants survived in lines those PRs added or changed.
- [ ] Each survivor in `server/services/write-cards/grocery.ts` and
      `server/services/write-cards/pantry.ts` is either killed by a new test or listed with
      the reason it is equivalent.
- [ ] If the check failed for a reason other than survivors (time limit, set-up error), that
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
