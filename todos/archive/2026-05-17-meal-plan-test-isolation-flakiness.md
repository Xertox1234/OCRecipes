---
title: "Investigate test-isolation flakiness in meal-plan.test.ts"
status: done
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

### 2026-05-17 (resolution)

- The original 3 `meal-plan.test.ts` failures did not reproduce across 10+ full-suite and route-suite runs, consistent with the todo's own observation.
- Identified one concrete cross-test interference mechanism in `meal-plan.test.ts` and fixed it: `POST /api/meal-plan/recipes` fires `generateRecipeImage` as a `fireAndForget` background promise whenever the created recipe has no `imageUrl` (the factory default). `generateRecipeImage` was NOT mocked, so the real service ran after the test finished — pulling in `lib/openai`/`lib/runware`, potentially making network calls, and resolving onto the microtask queue where it calls the shared `storage.updateMealPlanRecipe` mock. That leaks mock state into whatever route test runs next in the same Vitest worker. Fix: added `vi.mock("../../services/recipe-generation")` returning `generateRecipeImage: vi.fn().mockResolvedValue(null)`.
- Suite-wide flakiness in _other_ route test files (`profile-hub.test.ts`, `recipe-catalog.test.ts`, `recipes.test.ts`, `cooking.test.ts`) was observed during investigation — different files fail each run, none reproduce in isolation. These have separate root causes (e.g. timing-sensitive `vi.doUnmock`-based real-rate-limiter tests) and are out of scope for this todo, which is scoped to `meal-plan.test.ts`.
