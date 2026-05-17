---
title: "Investigate test-isolation flakiness in meal-plan.test.ts"
status: backlog
priority: low
created: 2026-05-17
updated: 2026-05-17
assignee:
labels: [deferred, testing]
github_issue:
---

# Investigate test-isolation flakiness in meal-plan.test.ts

## Summary

`server/routes/__tests__/meal-plan.test.ts` failed 3 tests in a single full `npm run test:run` during the `/todo` run for the Spoonacular search todo (PR #212). The failures did not reproduce: the file passes 56/56 in isolation, and a subsequent full-suite run on PR #212's branch passed all 5237 tests. This points to non-deterministic test-isolation sensitivity (shared module state or Vitest worker/file-ordering interaction), not a code defect.

## Background

Observed 2026-05-17. The Spoonacular-source executor reported 3 failures in `meal-plan.test.ts` in its worktree's full run; the orchestrator could not reproduce them (full suite on the same branch ran clean at 5237/5237, and the Phase 1 + Phase 5 baselines on `main` were both fully green). Flaky tests cause spurious CI failures and erode trust in the suite, so the root cause should be found even though no run is currently red.

## Acceptance Criteria

- [ ] Reproduce the flakiness (e.g. repeated full-suite runs, varied worker counts, or `--sequence.shuffle`) to identify the 3 unstable tests.
- [ ] Identify the shared-state or ordering dependency causing the cross-test interference.
- [ ] Fix it — isolate the leaking state (per-test setup/teardown, fresh mocks, or module reset) so the tests pass deterministically regardless of run order.
- [ ] Confirm with multiple full-suite runs.

## Implementation Notes

- Detail is thin — only one observed failure, not reproduced. First step is reliable reproduction; without the specific failing test names and assertions this cannot be fixed blind.
- Likely culprits: module-level singleton state, an unmocked/un-reset shared mock, or a global touched by another route test that runs in the same Vitest worker.

## Dependencies

- None.

## Risks

- Low. This is test-infrastructure hygiene; no production code is implicated.

## Updates

### 2026-05-17

- Created during the `/todo` run for the Spoonacular search todo (PR #212). The 3 failures were confirmed non-reproducible (flaky), not a regression.
