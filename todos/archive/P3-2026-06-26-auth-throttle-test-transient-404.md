<!-- Filename: P{0-3}-YYYY-MM-DD-short-description.md  (P0=critical … P3=low) -->

---

title: "Investigate transient 404 in auth-account-throttle test (separate from the store-pollution flake)"
status: done
priority: low
created: 2026-06-26
updated: 2026-06-26
resolution: not-reproducible
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

- [x] Determine the conditions under which `POST /api/auth/login` can return 404 in this test file (e.g. `beforeAll`/`register(app)` not completing before a request, a cross-file mock leak affecting route registration, or a module-init ordering race under full-suite parallelism).
- [x] Either reproduce the 404 deterministically and fix the root cause, or document why it cannot recur and close as not-reproducible. → **documented as not-reproducible** (structurally impossible after `beforeAll`; see Updates 2026-06-26 resolution).
- [x] If a fix is made, it does not weaken the existing throttle assertions or the store-reset isolation added in PR #462. → no behavioral fix made (none needed); only the in-file NOTE comment was rewritten, so PR #462's store-reset isolation and all throttle assertions are untouched.

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

### 2026-06-26 — resolved (not-reproducible)

Investigated and closed as **not-reproducible** because a 404 on `POST /api/auth/login` in this test is **structurally impossible after `beforeAll`**, not merely unobserved:

- **No 404 source on the handler path.** The login handler + its middleware emit only 401 / 403 / 200 / 429, and `handleRouteError` (`server/routes/_helpers.ts`) maps `ZodError` → 400 and everything else → 500 — never 404. The sole 404 source on this route is Express's unmatched-route default (route absent at request time).
- **The route is always present by request time.** `register(app)` (`server/routes/auth.ts:125`, returns `void`) registers `/api/auth/login` unconditionally and synchronously inside an awaited `beforeAll`, which Vitest guarantees completes before any test. All three candidate triggers are excluded: (a) `beforeAll`-incomplete — `register()` is sync, nothing unawaited; (b) cross-file `vi.mock` bleed of `register` — `pool: "forks"` (`vitest.config.ts:62`) + default `isolate: true` give each file its own module graph, and `../auth` (the SUT) is never mocked here; (c) module-init ordering race — `register` runs to completion in `beforeAll`.
- **The single observation** (one retry attempt in one PR #460 preflight run; file passes in isolation, CI green, no recurrence) has no in-file mechanism → attributable to cross-test output aggregation / worker noise under peak full-suite parallelism (the documented load-flake family, `docs/LEARNINGS.md`). Per that learning's rule, **no defensive guard added** — a guard would mask, not fix, and there is no reproducible cause.

Code change: rewrote the in-file NOTE comment in `server/routes/__tests__/auth-account-throttle.test.ts` from "out of scope" to a RESOLVED explanation. No production code, no test logic, no assertion changes; PR #462's store-reset isolation untouched.
