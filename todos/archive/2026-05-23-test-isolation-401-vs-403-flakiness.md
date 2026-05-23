---
title: "Investigate test-isolation flakiness (401-vs-403 + timeout under parallel runs)"
status: done
priority: medium
created: 2026-05-23
updated: 2026-05-23
assignee:
labels: [deferred, testing]
github_issue:
---

# Investigate test-isolation flakiness (401-vs-403 + timeout under parallel runs)

## Summary

Under a full parallel coverage run, two server route tests failed in ways that smell like cross-test state leakage rather than real regressions. Reproduce, root-cause, and harden the isolation so the full suite is deterministic.

## Background

Surfaced by the 2026-05-23 testing audit. Two failures during `npm run test:coverage` (5,348/5,350 passing):

1. `server/routes/__tests__/recipe-catalog.test.ts:105` — "returns 403 when subscriptionTier is free (H7)" asserted **403 PREMIUM_REQUIRED** but received **401**. A 401 means the request failed _auth_, not the _premium gate_ — i.e. the `requireAuth` mock did not set `req.userId` for that run. That points to a mock being cleared/leaked between files in the same worker, not a logic bug in the route.
2. `server/routes/__tests__/subscription.test.ts` — "handles no valid subscription found" hit the 10s `testTimeout`, consistent with worker contention / an unresolved mocked promise.

Both pass in isolation (per the known full-suite flakiness noted in project memory). The 401-vs-403 case is the more concerning one because it implies the auth mock's `req.userId` assignment isn't reliably present.

## Acceptance Criteria

- [ ] Reproduce the 401-vs-403 failure deterministically (e.g. run `recipe-catalog.test.ts` in the same worker/shard as its noisy neighbors, or with a fixed seed/order)
- [ ] Identify the leaking state: which `vi.mock` / shared singleton / `mockReset` vs `clearAllMocks` interaction causes `requireAuth` to stop setting `req.userId`
- [ ] Fix the root cause (likely a mock-lifecycle issue per `docs/rules/testing.md` — e.g. an unmocked `fireAndForget` service, or a `clearAllMocks`-vs-`resetAllMocks` mismatch draining a once-queue)
- [ ] Investigate the `subscription.test.ts` timeout — confirm whether it's pure contention (acceptable, document it) or an unresolved mock promise (fix it)
- [ ] Full `npm run test:coverage` passes cleanly across several consecutive local runs

## Implementation Notes

- Relevant rules: `docs/rules/testing.md` — the `fireAndForget` background-promise leak and the `clearAllMocks` vs `resetAllMocks` once-queue notes are prime suspects.
- The shared auth mock lives at `server/middleware/__mocks__/auth.ts` (sets `req.userId = "1"`, calls `next()`); route tests opt in via `vi.mock("../../middleware/auth")`. Check whether `vi.clearAllMocks()` in `test/setup.ts` is wiping that manual mock's implementation in some ordering (clearAllMocks clears call history but not implementation — but a `mockReset` somewhere could).
- Grep the noisy route modules for `fireAndForget(` and confirm every invoked service is mocked in the test file.
- This is a real-DB integration area; ensure findings aren't just `.env`/DB-connection noise (verify the failing assertion is genuinely about app logic, not a dropped DB connection).

## Dependencies

- None.

## Risks

- Heisenbug: order-dependent failures are slow to reproduce. May need `--sequence.seed` pinning or running specific file groups together to surface it reliably.

## Updates

### 2026-05-23

- Initial creation (from testing audit).

### 2026-05-23 — Investigation (manual, systematic-debugging)

**Conclusion: probabilistic timing/CPU-contention flake under full-suite parallel
load. No deterministic root cause. The "401-vs-403 ⇒ requireAuth mock is
unreliable" hypothesis is REFUTED.**

Evidence:

- Every observed flaky test is a _fully-mocked_ route test (`storage` + `auth` +
  `express-rate-limit` all mocked) — none touch the real DB. Shared-DB
  contamination is ruled out for these (confirmed by reading the mock setups in
  `auth.test.ts`, `medication.test.ts`, `recipe-catalog.test.ts`).
- Failures **rotate every run and never repeat**. Across 6 full-suite runs the
  failing test was, in turn: `auth` + `medication` (capped baseline), `weight`
  (uncapped), `micronutrients` (capped, timeout), `fasting` (capped, 404-vs-400);
  **2 of the 4 capped runs were fully clean (5362/5362)**. No test failed twice
  with the same signature.
- Two failure modes: (a) **request timeout** (10s) — a mocked middleware never
  called `next()`; correlates with worker starvation (uncapping via `CI=true`
  amplified it), already mitigated by the local `maxWorkers = cpus-3` cap; (b)
  **wrong HTTP status** (404/401) — a mock returned the wrong value at request
  time under contention.
- Controlled experiment (`--maxWorkers=1`, forcing the only `resetAllMocks` file
  [`notification-scheduler.test.ts`] adjacent to victim route tests): **passes
  under both `isolate:true` (real config) and `isolate:false`.** So
  `resetAllMocks` does NOT leak across the file-isolation boundary.
- `vi.clearAllMocks()` (in `test/setup.ts` + per-file `beforeEach`) clears call
  history but NOT implementations, so the shared `__mocks__/auth.ts` `requireAuth`
  impl (`req.userId = "1"`; `next()`) is preserved between tests — consistent with
  the experiment. The auth mock is not the problem.

Not reproducible: any deterministic cross-test mock leak or auth-mock failure.
The flake only appears probabilistically under full-suite parallel CPU contention
(~1 flake per ~2 local runs; ~50% of runs fully clean).

Existing mitigation: `vitest.config.ts` already caps local workers
(`maxWorkers = cpus-3`) to curb starvation timeouts; established practice is to
re-run a named file in isolation before treating a full-suite failure as a
regression.

AC status: "full `test:coverage` passes cleanly across several consecutive local
runs" is not _deterministically_ achievable without either (a) a test-level
`retry`, or (b) deeper restructuring (e.g., isolating DB-touching tests into a
single-fork vitest project). Both are policy decisions left to the maintainer.
