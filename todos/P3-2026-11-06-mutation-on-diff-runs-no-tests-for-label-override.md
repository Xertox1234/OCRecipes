---
title: "Mutation-on-diff runs no tests for server/services/label-override.ts"
status: backlog
priority: low
created: 2026-11-06
updated: 2026-11-06
assignee:
labels: [deferred, ci, testing]
github_issue:
---

# Mutation-on-diff runs no tests for server/services/label-override.ts

## Summary

The advisory `Mutation-on-diff` CI check failed on PR #1783 because Stryker ran zero tests against `server/services/label-override.ts`. It printed `ConfigError: No tests were executed. Stryker will exit prematurely.`, yet the module's tests exist and pass (`server/services/__tests__/label-override.test.ts`, 53 tests).

## Background

Seen on PR #1783 (run 42296601188, job 128163348614), 2026-11-06. The two client modules in the same run were measured normally: `LogActionBar-utils.ts` scored 91.3% and `nutrition-detail-utils.ts` 95.3%. The server module's row read `⚠️ explore exited 1`. The check is advisory, not one of the required checks, so it did not block the merge. It does mean label-override changes get no mutation signal. The owner asked for a todo so they can look at it later.

Not yet investigated. Likely suspects:

- the test glob `scripts/ci/mutation-on-diff.mjs` derives for a `server/` module;
- the Vitest config or project Stryker loads (`stryker.explore.conf.mjs`) not including `server/**` tests.

## Acceptance Criteria

- [ ] Find why Stryker's dry run executes no tests for `server/services/label-override.ts` (reproduce with `npm run mutation:explore -- server/services/label-override.ts <test-glob>`).
- [ ] Check whether every `server/` module is affected, or only this one.
- [ ] Fix the selection or config so a changed server module with co-located tests gets a mutation score, or record why server modules are out of scope and make the check skip them cleanly instead of failing.

## Implementation Notes

- Workflow: `.github/workflows/mutation-on-diff.yml`. Selection and run: `scripts/ci/mutation-on-diff.mjs`. CLI: `scripts/mutation-explore.mjs` (`STRYKER_EXPLORE_TEST`). Config: `stryker.explore.conf.mjs`, `stryker.targets.mjs`.
- Read the failing job with `npm run ci:failed-logs -- 42296601188`.

## Scope Contract

- **Mechanisms to use:** the existing mutation scripts and config.
- **Files in scope:** the files listed above and their tests.
- No new mechanisms, files, or abstractions beyond those listed.

## Updates

### 2026-11-06

- Filed at the owner's request from the PR #1783 CI run.
