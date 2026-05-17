---
title: "Flaky 401 in verification.test.ts cross-user submit test (auth mock intermittently not applied)"
status: backlog
priority: low
created: 2026-05-16
updated: 2026-05-16
assignee:
labels: [deferred, testing]
github_issue:
---

# Flaky 401 in verification.test.ts cross-user submit test

## Summary

`server/routes/__tests__/verification.test.ts` → `POST /api/verification/submit`
→ "returns 404 (not 403) for another user's label session" intermittently fails
the full local suite with `expected 401 to be 404`. Observed once in 27
full-suite runs; never reproduced since. CI on `main` is consistently green.

## Background

Observed during a `/todo` Phase 1 baseline pass on 2026-05-16:

- One full-suite run failed `verification.test.ts:454` with `res.status === 401`
  where `404` was expected.
- The file passes 26/26 tests in isolation and passed 26 consecutive
  subsequent full-suite runs (6 plain + 20 instrumented).
- The instrumented runs logged `res.status`, `res.body`, and the auth-mock
  state at the assertion point. Every passing run showed
  `isMock=true calls=1 impl=(req,_res,next)=>{req.userId="1";next();}` — the
  manual mock applied correctly.

Root-cause signal: the `401` status is the unmistakable fingerprint of the
**real** `requireAuth` middleware — `server/middleware/auth.ts:101`
(`sendError(res, 401, "No token provided", "NO_TOKEN")`). No code path in the
mocked test can emit `401`:

- `vi.mock("../../middleware/auth")` swaps in `server/middleware/__mocks__/auth.ts`,
  whose `requireAuth` is a passthrough that sets `req.userId = "1"` and calls
  `next()` — it never touches `res`.
- `vi.mock("express-rate-limit")` resolves to `__mocks__/express-rate-limit.ts`,
  a clean `(req,res,next)=>next()` passthrough.
- The `/submit` handler only emits `404 / 400 / 409 / 200`, or `500` via
  `handleRouteError`.

So intermittently, `vi.mock("../../middleware/auth")` did **not** apply the
manual mock and the real `auth.ts` module ran instead. This is a vitest
module-mock-application flake, almost certainly load-induced: the failing run
was the first of the session, immediately after the SessionStart hook
provisioned PostgreSQL (PR #205) — peak machine load. It aligns with the prior
known fork-pool-starvation flake
(`todos/archive/2026-05-15-flaky-full-suite-fork-pool-starvation.md`), though
that one manifested as `testTimeout` kills rather than a wrong status code.

This is **not** a real security regression — the cross-user-to-404 behavior
(PR #204) is correct and verified by 26 green runs + green CI.

## Acceptance Criteria

- [ ] Reproduce the failure deterministically (e.g. force CPU contention with
      `yes >/dev/null` across all cores while running the full suite, or run
      with `--poolOptions.forks.singleFork`), OR conclude it is purely
      environmental and not reproducible.
- [ ] If reproduced: identify why `vi.mock("../../middleware/auth")` fails to
      apply the manual mock under load, and fix the root cause (not the symptom).
- [ ] If not reproducible after a bounded effort: document the flake in
      `docs/LEARNINGS.md` so a future false-red `verification.test.ts:454` run
      is recognized, not chased.

## Implementation Notes

- Re-add instrumentation at `verification.test.ts:454` if it recurs: import the
  mocked `requireAuth`, log `vi.isMockFunction(requireAuth)`,
  `.mock.calls.length`, and `.getMockImplementation()` alongside
  `res.status` / `res.body`. A failing run with `isMock=false` confirms the
  real module loaded; `calls=0` confirms `verification.ts` resolved a different
  (real) module instance.
- Consider whether the `__mocks__`-folder manual mock for `auth` is more
  flake-prone than an inline `vi.mock("../../middleware/auth", () => ({...}))`
  factory under load — converting it removes the separate `__mocks__` file load
  from the hot path.
- Do NOT add a defensive retry or a symptom-level guard to the test without a
  reproduced root cause — a passing test that masks a mock-application race is
  worse than a documented flake.

## Dependencies

- None.

## Risks

- Low. The behavior under test is correct; CI is the source of truth and is
  green. Worst case is occasional manual triage of a local false-red.

## Updates

### 2026-05-16

- Created during `/todo` Phase 1 after a single baseline full-suite run failed
  `verification.test.ts:454` (`expected 401 to be 404`). Investigated with the
  systematic-debugging skill: ruled out every in-test `401` source, traced the
  status to the real `requireAuth` middleware, confirmed non-reproducible
  across 26 subsequent runs. Diagnosed as a load-induced vitest
  mock-application flake; baseline declared green to unblock `/todo`.
