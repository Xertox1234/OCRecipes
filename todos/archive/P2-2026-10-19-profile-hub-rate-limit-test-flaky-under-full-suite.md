---
title: "profile-hub-rate-limit test fails under the full suite, passes alone"
status: done
priority: medium
created: 2026-10-19
updated: 2026-10-19
assignee:
labels: [deferred, testing, server]
github_issue:
---

# profile-hub-rate-limit test fails under the full suite, passes alone

## Summary

`server/routes/__tests__/profile-hub-rate-limit.test.ts` failed once during a full `npm run test:run` on main at `25ed728a`. The 61st request got 200 when 429 was expected. Run alone, it passed 3 out of 3 times. A flaky test on main can turn any PR's CI red, so it should be made deterministic.

## Background

This was found during the Phase 5 verification of a `/todo` run on 2026-10-19. The two PRs that had just merged (#1522 and #1523) touched only client files. The same test had passed in the Phase 1 baseline an hour earlier, at `42c60f11`.

Observed output from the full run:

- First attempt: `expected 200 to be 429` at line 37 (the overflow request was not limited).
- Retries: `expected 429 to be 200` (the early requests were already limited). This fits a module-level limiter whose counter carries over from the first attempt. `hubRateLimit` is created at import time in `server/routes/profile-hub.ts`.
- The test file took 222ms in the failing run.

The cause of the first-attempt 200 is **not established**. Two explanations were ruled out:

- **Cross-file sharing of the limiter:** Vitest runs with `pool: "forks"` and default isolation, so each test file loads its own copy of the module.
- **The 60s window expiring mid-test:** the file ran in 222ms. express-rate-limit 8.5.2's `MemoryStore` sets `resetTime = now + windowMs` per client on the first hit.

What's left to check is the limiter's key and skip behaviour under load: the `createRateLimiter` options in `server/routes/_rate-limiters.ts`, and whether the auth mock gives a stable key. The other candidate is something else in the suite's environment, such as a `NODE_ENV` or `RATE_LIMIT_*` variable read at import time.

## Acceptance Criteria

- [x] Find the cause of the first-attempt 200, with evidence (for example, logging the key and hit count in a looped full-suite run).
- [x] The test builds its own limiter or resets the store between attempts, so retries don't inherit counts.
- [x] The test passes in 20 consecutive full-suite runs, or in a loop that reproduces the failing condition.

## Implementation Notes

- `server/routes/__tests__/profile-hub-rate-limit.test.ts`
- `server/routes/profile-hub.ts`: `hubRateLimit` is module-level.
- `server/routes/_rate-limiters.ts`: the `createRateLimiter` factory and its key/skip options.
- Related: `docs/solutions/*/testing-real-express-rate-limit-bypass-passthrough-2026-05-13.md`.

## Dependencies

- None.

## Risks

- A fix that only adds a reset hides the first-attempt failure without explaining it. Find the cause first.

## Updates

### 2026-10-19

- Filed from the `/todo` Phase 5 verification (full suite 1 failed / 12,442 passed; isolated reruns 3/3 passed).

### 2026-10-20

- Cause found. Running the test file 12 to 80 times in parallel with `--retry=0` reproduced the failure (about 1 in 12 on the original test). A diagnostic loop that logged every response showed 1 to 3 of the 61 requests answered by a different server: a Dart `shelf` 403 ("missing or invalid authentication code"), a foreign Express 401 `Unauthorized`, and a 400 "WebSockets request was expected". Those never reach `hubRateLimit`, so it counted 60 or fewer hits and the 61st got 200.
- Mechanism (inferred from those responses, not proven at socket level): `supertest(app)` opens a new wildcard listener on an ephemeral port per request, and on macOS another process can bind `127.0.0.1:<same port>` beside it. The client connects to 127.0.0.1 and reaches the other process. Ruled out: the limiter key (userId "1"), MemoryStore window expiry, and cross-file module sharing.
- Fix: the test now binds one server to 127.0.0.1, builds a fresh module graph per attempt (`vi.resetModules` plus dynamic imports) so retries do not inherit counts, and requires every one of the 60 requests to be a 200 carrying `ratelimit-limit`, so a foreign response fails loudly.
- Verified: 3 rounds of 40 parallel `--retry=0` runs, 120 of 120 passed. The full-suite 20-run criterion was met by this load loop instead.
