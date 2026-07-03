---
title: CodeQL js/missing-rate-limiting fires on integration tests that mount an auth route — inline a traceable limiter
track: bug
category: code-quality
module: server
severity: low
tags: [codeql, code-scanning, js-missing-rate-limiting, express-rate-limit, integration-test, requireAuth, security-tooling, false-positive]
symptoms: [The non-required "CodeQL" check (GitHub Advanced Security alert diff) fails with "1 new alert including 1 high severity security vulnerability" while the required "Analyze (javascript-typescript)" job passes, 'Alert rule js/missing-rate-limiting: "This route handler performs authorization, but is not rate-limited" on a *.test.ts line', 'The flagged route is a test-only fixture mounted behind real requireAuth (e.g. a probe app), never deployed', 'mergeStateStatus is UNSTABLE (not BLOCKED) — the PR is still mergeable, but merging files the alert against main']
applies_to: [server/routes/__tests__/*.ts, server/**/__tests__/*.ts]
created: '2026-06-27'
---

# CodeQL js/missing-rate-limiting fires on integration tests that mount an auth route — inline a traceable limiter

## Problem

An auth **wiring** integration test (one that deliberately does *not* mock `middleware/auth`, to prove a real token composes through `requireAuth` into a handler) mounts a route behind real `requireAuth` on a bare `express()` app. CodeQL's `js/missing-rate-limiting` query sees a route handler that performs authorization with no rate-limiting middleware on the path and files a **new high-severity alert attributed to the PR**. The required `Analyze (javascript-typescript)` job still passes (the scan *ran*); the separate, **non-required** `CodeQL` alert-diff check goes red.

## Symptoms

- The `CodeQL` check fails in ~3s with output "1 new alert including 1 high severity security vulnerability", while `Analyze (javascript-typescript)` is green.
- Annotation: `js/missing-rate-limiting` — "This route handler performs authorization, but is not rate-limited" — pointing at a `__tests__/*.test.ts` route registration.
- `mergeStateStatus: UNSTABLE`, `mergeable: MERGEABLE` (the alert check is not in the required set), so the PR is mergeable but would file the alert onto `main`.

## Root Cause

Three things compose:

1. **CodeQL analyzes the literal registration in the test file.** A `app.get("/__probe", requireAuth, handler)` written inline is attributed to the test file. Sibling routes mounted via imported `register(app)` functions are attributed to *their own* module files, so only the hand-rolled inline probe is flagged here.
2. **The bare test app omits the limiter that production has.** Every protected route group (profile, goals, grocery, cookbooks, …) sits behind a limiter from `server/routes/_rate-limiters.ts` (`crudRateLimit`, `exportRateLimit`, et al.). The probe app skips it because rate limiting is irrelevant to what the test asserts.
3. **CodeQL cannot trace limiters applied via the re-exported factory consts.** `_rate-limiters.ts` builds limiters with a `createRateLimiter` factory and exports them as consts; CodeQL's dataflow does not follow that indirection (this is the historically **dismissed #146–#215 alert cluster** — real-but-untraceable production limiters). So even copying the production approach (`app.use(crudRateLimit)`) would *not* clear the alert.

## Solution

Mirror production's middleware stack in the fixture **and** make the limiter traceable: apply `express-rate-limit`'s `rateLimit({...})` **inline** as a per-route argument — exactly the pattern `server/index.ts` uses for `/api/health`, whose comment documents "inlined so CodeQL's js/missing-rate-limiting query can trace it." In a test the import resolves to the pass-through `express-rate-limit` mock, so it changes **no behavior**:

```ts
import { rateLimit } from "express-rate-limit";

// limiter → requireAuth → handler, matching a real protected route's stack.
// Inlined (not via the _rate-limiters.ts factory consts) so CodeQL can trace it.
app.get(
  "/__probe",
  rateLimit({ windowMs: 60_000, max: 600 }),
  requireAuth,
  (req, res) => res.json({ userId: req.userId }),
);
```

Do **not** reach for the `_rate-limiters.ts` factory consts (`crudRateLimit`, …) in the fixture — CodeQL can't trace them, so the alert would persist.

**Alternative — dismiss as "Used in tests."** Legitimate (it is a test fixture) and matches the #146–#215 precedent, but it leaves a dismissed-alert record and re-triggers for the next such test. The inline-limiter fix is preferable: it keeps the security dashboard clean (no alert, no dismissal) and makes the fixture a faithful miniature of production. Confirm the choice with the owner — dismissing or editing a security-gate item is an outward security action.

## Prevention

- A green `Analyze (javascript-typescript)` means the scan **ran**, not that it found nothing. Always read the separate `CodeQL` alert check before declaring a PR "green."
- The `CodeQL` alert check is **not** a required status check, so a red here does not block merge — but merging files a *new high-severity alert against `main`*. Treat it as worth-fixing-before-merge, not cosmetic.
- When an integration test mounts a route behind real `requireAuth`, give it a traceable inline limiter (limiter → auth → handler) so it both mirrors production and stays out of the alert diff.

## Related Files

- `server/routes/__tests__/auth-route-wiring.test.ts` — the probe fixture; carries the inline limiter (PR #466, commit 2e14a0e9)
- `server/index.ts` — the `/api/health` inline-limiter precedent and the comment documenting CodeQL traceability
- `server/routes/_rate-limiters.ts` — the `createRateLimiter` factory whose re-exported consts CodeQL cannot trace

## See Also

- [fileurltopath-new-url-fails-tsc-under-dom-lib-2026-06-26.md](fileurltopath-new-url-fails-tsc-under-dom-lib-2026-06-26.md) — sibling tooling-vs-test gotcha in the same file (tsc DOM-lib clash); both are "the runner/scan disagrees with a green local test"
- [../conventions/route-tests-mock-auth-hide-wiring-seam-2026-06-26.md](../conventions/route-tests-mock-auth-hide-wiring-seam-2026-06-26.md) — the wiring-seam convention this test implements; the probe is its real-middleware mount
