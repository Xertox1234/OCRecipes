<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Investigate transient 404 in auth-account-throttle test (separate from the store-pollution flake)"
status: backlog
priority: low
created: 2026-06-26
updated: 2026-06-26
assignee:
labels: [deferred, testing]
github_issue:

---

# Investigate transient 404 in auth-account-throttle test

## Summary

The original P3 store-pollution flake report (PR #460 preflight) listed a transient **`404`** among the observed failing statuses for `server/routes/__tests__/auth-account-throttle.test.ts`. The store-reset fix (PR #462) does **not** address it — a 404 cannot originate from a rate limiter (that path returns 429) — so the 404 remains an unexplained, separate symptom to investigate if it recurs.

## Background

PR #462 closed the rate-limiter `MemoryStore` store-pollution flake (cross-test/retry bucket leakage producing `401`→`429`). During that work it was noted that a `404` was also seen in the original report. A 404 on `POST /api/auth/login` means the route was not registered on the `app` at request time, which points at a **`register(app)` / module-init timing symptom**, not store pollution. The PR #462 reset only helps retries _recover_ from such a race (clean buckets on the next attempt) — it does not remove the trigger.

This is filed as a low-priority deferred item: the 404 was intermittent, has not been reproduced deterministically, and is test-only (no production impact). Pick it up only if it recurs in CI/preflight.

## Acceptance Criteria

- [ ] Determine the conditions under which `POST /api/auth/login` can return 404 in this test file (e.g. `beforeAll`/`register(app)` not completing before a request, a cross-file mock leak affecting route registration, or a module-init ordering race under full-suite parallelism).
- [ ] Either reproduce the 404 deterministically and fix the root cause, or document why it cannot recur and close as not-reproducible.
- [ ] If a fix is made, it does not weaken the existing throttle assertions or the store-reset isolation added in PR #462.

## Implementation Notes

- Target file: `server/routes/__tests__/auth-account-throttle.test.ts`. The `app` is built once in `beforeAll` (`app = express(); app.set("trust proxy", 1); register(app); ...`). A 404 implies the login route was absent when a request fired.
- Lines of inquiry:
  - Confirm `beforeAll` always completes before any test runs (Vitest guarantees this per-file, but check for an unawaited promise inside it).
  - Check whether a sibling test file mocking `../auth` or `../routes` could leak a partial/empty `register` into this worker (cross-file `vi.mock` bleed). The header already documents the deliberate "no `vi.mock("express-rate-limit")`" choice — verify nothing else mocks the route registrar.
  - Reproduce under full-suite parallelism (the original context was `npm run preflight`, not the file in isolation, which passes 10/10).
- The PR #462 test header (`server/routes/__tests__/auth-account-throttle.test.ts`, "NOTE on the original flake report") already records the 404 as out-of-scope — update/remove that note when this is resolved.

## Dependencies

- None. PR #462 (the store-reset fix) is already merged (`main` @ `e1196a37`).

## Risks

- Low / may be non-reproducible. The 404 was observed once and has not recurred; this may resolve to a "cannot reproduce — document and close" outcome. Test-only; no production impact.

## Updates

### 2026-06-26

- Initial creation. Split out from the PR #462 store-pollution fix, which deliberately scoped the 404 out (a 404 cannot come from a rate limiter — separate `register(app)`/init-timing symptom).
