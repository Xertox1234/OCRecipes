<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Reset express-rate-limit store between real-limiter tests (retry:2 doesn't cover store pollution)"
status: done
priority: low
created: 2026-06-26
updated: 2026-06-26
completed: 2026-06-26
assignee:
labels: [deferred, testing]
github_issue:

---

# Reset express-rate-limit store between real-limiter tests

## Summary

`server/routes/__tests__/auth-account-throttle.test.ts` ("per-account login throttling (real express-rate-limit)") intermittently fails under full-suite parallelism — observed failing **all three `retry:2` attempts** in one `npm run preflight` run with non-deterministic statuses (404, then 429 vs the expected 401), yet passing 10/10 in isolation. The existing "retry:2 resolves flakiness" disposition does NOT cover this case, because the failure is module-level store pollution, not transient CPU contention.

## Background

express-rate-limit keeps its counter in a **module-level in-memory `Map`** (the default `MemoryStore`). The real-limiter tests (`loginAccountLimiter`, etc.) share that store across tests in the same Vitest worker. When another test (or a retry within the same process) leaves an account/IP bucket dirty, a later assertion sees a stale `429`/unexpected status instead of the expected `401`. `retry:2` cannot fix this because retries re-run inside the same polluted process.

Surfaced during PR #460 (rate-limiting `/api/health`); the flake was confirmed unrelated to that change (the test does not import the changed file, and passed on full re-run).

## Acceptance Criteria

- [x] The real-express-rate-limit throttle tests reset/recreate the limiter store in `beforeEach` (or instantiate a fresh limiter per test) so buckets cannot leak across tests.
- [x] Running the full suite repeatedly (e.g. 5×) no longer reproduces the cross-test 401→429 flake. **Proven deterministically instead** (a green 5× run is weak evidence — the test already passed 10/10 in isolation pre-fix): a new ordered `[setup]`/`[verify]` pair fills a shared bucket then asserts the next case sees 401, and a mutation run (reset disabled) reproduces the exact `429`-instead-of-`401` failure across all `retry:2` attempts, confirming the guard.
- [x] The fix does not weaken what the tests assert (per-account keying, cosmetic-variant bucketing, IP-key fallback). Real `register(app)` wiring is preserved — the test still exercises the actual `loginLimiter` + `loginAccountLimiter` composition; all six original assertions are unchanged, plus two regression cases added.
- [ ] **NOT addressed (out of scope):** the transient `404` in the original report. A 404 cannot originate from a rate limiter (that path returns 429), so the store reset does not touch it — it points at a separate `register(app)`/module-init timing symptom. Flagged in the test header; track separately if it recurs.

## Implementation Notes

- Target file: `server/routes/__tests__/auth-account-throttle.test.ts` (and any sibling "real express-rate-limit" tests with the same pattern).
- Options: call the limiter's `store.resetAll()` / `resetKey()` in `beforeEach`, or construct a fresh `rateLimit({...})` instance per test (matching the production config) so each test owns an isolated store.
- Keep the production limiters in `server/routes/_rate-limiters.ts` untouched — this is a test-isolation fix only.
- Cross-ref memory: `project_test_suite_flakiness` (the retry:2 disposition) — note that real-limiter store pollution is the exception it doesn't cover.

## Dependencies

- None.

## Risks

- Low. Test-only change; the production limiter behavior is unchanged.

## Updates

### 2026-06-26

- Initial creation (surfaced during PR #460 preflight).
- **Resolved.** Implemented an active `beforeEach` store reset in
  `server/routes/__tests__/auth-account-throttle.test.ts`:
  - Verified empirically (throwaway probe) that Vitest runs `beforeEach`/`afterEach`
    **before each retry attempt** — the premise the fix depends on (the todo exists
    because `retry:2` re-runs in the same polluted process). Probe asserted
    `{ beforeEachRuns: 3, afterEachRuns: 2 }` on the 3rd attempt → hooks are per-attempt.
  - `login()` now records the exact production store keys it touches (derived via the
    same `normalizeUsernameKey` / `normalizeIpKey` helpers + the newly-exported
    `LOGIN_ACCOUNT_KEY_PREFIX` constant), and `beforeEach` drains them via `resetKey()`
    on both real limiters. Middleware exposes `resetKey` but not `resetAll`.
  - `server/routes/_rate-limiters.ts`: extracted `login-account:` into the exported
    `LOGIN_ACCOUNT_KEY_PREFIX` constant (behavior-identical) so the test reset can't
    silently drift from the production keyGenerator.
  - Added an ordered `[setup]`/`[verify]` regression pair as a deterministic proof +
    drift guard; confirmed it fails (`429`≠`401`) when the reset is disabled.
  - 12/12 tests pass on two consecutive runs. The original-report `404` is documented
    as a separate, unaddressed symptom (see Acceptance Criteria).
