---
title: Route tests that mock the auth middleware leave the route↔requireAuth wiring seam untested
track: knowledge
category: conventions
module: server
tags: [testing, auth, middleware, wiring-seam, route-registration, guard-test, requireAuth, integration-test]
applies_to: [server/routes/**/*.ts, server/routes/__tests__/*.ts]
created: '2026-06-26'
last_updated: 2026-10-10
---

# Route tests that mock the auth middleware leave the route↔requireAuth wiring seam untested

## When this applies

Every route test under `server/routes/__tests__/` does `vi.mock("../../middleware/auth")`, which swaps `requireAuth` for a no-op that just sets `req.userId` and calls `next()`. That is correct for testing handler logic — but it leaves three layers, of which only two are covered:

1. **Middleware logic** (does `requireAuth` accept/reject tokens?) — covered by `server/__tests__/auth.test.ts` calling it directly.
2. **Handler logic** (does the handler behave, given a `userId`?) — covered by the 40-odd mocked-auth route tests.
3. **The wiring seam** — is the handler actually *registered behind* `requireAuth`, in the right order, composing through real Express? — covered by **nothing**.

A route accidentally registered without `requireAuth` passes every existing test while shipping an open endpoint. This is the layer where recurring auth regressions hide — see [[project_auth_recurring_breakage]].

## Smell patterns

- A new `app.get("/api/…", handler)` lands with only a route test that does `vi.mock("../../middleware/auth")`.
- "All our route tests mock the auth middleware" coexisting with "auth keeps breaking in prod."

## Why

Mocking the middleware per-route is the right call (you don't re-test JWT verification on every endpoint), so the seam cannot be covered by the route tests themselves. It needs two dedicated, cheap guards:

1. **A real-middleware mount test** — mount representative route groups via their real `register(app)` *without* mocking `middleware/auth`; mock only `storage.getUser` (the tokenVersion lookup). Assert anonymous/malformed requests get `401`, and a valid token composes through into a probe handler with `req.userId` set. Proves the mechanism composes at runtime.
2. **A static source-scan guard** — parse every `app.METHOD("/api…")` registration across all route modules and assert `requireAuth` is in the chain, except an explicit, annotated allowlist of public routes. Covers EVERY module (not just enumerated ones) and fails the day a new route forgets auth.

The runtime test proves *composition*; the static guard provides *comprehensive, human-independent* coverage (a matrix of enumerated routes depends on someone remembering to add a row — the same lapse that forgets `requireAuth`). Both must be proven **fail-closed**: temporarily remove `requireAuth` from a route and confirm the test goes red. A guard that can't fail is a tautology.

## Examples

`server/routes/__tests__/auth-route-wiring.test.ts` (PR #466). Key moves:

- The file deliberately does **not** `vi.mock("../../middleware/auth")` — it runs the real module, mocking only `storage` and `express-rate-limit`.
- The static scan documents its load-bearing assumptions in-file (`app.METHOD` only, literal-string paths, inline-arrow handlers) and adds an allowlist stale-entry test plus a route-count floor so it can't pass vacuously.
- Fail-closed was demonstrated for both layers: removing `requireAuth` from `/api/carousel` (in the matrix) failed exactly its smoke cases; removing it from `/api/recipes/featured` (*not* in the matrix) failed *only* the static guard.

### The inline-arrow assumption is load-bearing: a bare handler call lets a route slip past

The static scan reads forward from each `app.METHOD(` line and stops at the first line containing `=>` or `async (`, which it takes to be the handler body. If the handler is a bare call such as `setTriedHandler(true)`, no line contains either token. The window then runs on into the **next** registration, finds that route's `requireAuth`, and passes the unprotected one.

Measured in PR #1365 (2026-10-10), with `PUT` and `DELETE /api/recipes/:id/tried` both using `setTriedHandler(...)`:
- With `requireAuth` removed from the PUT only, the static guard stayed green.
- Only the runtime `401` rows failed (2 of 36).
- After rewriting the handlers as inline arrows (`(req, res) => setTried(req, res, true)`), the same removal also failed the static guard (3 of 36).

A dynamic `app[tried ? "put" : "delete"](...)` is worse: the `app\.(get|…)\(` regex never matches it, so the route isn't scanned at all.

**Rule:** register every route as a literal `app.METHOD("/path", …middleware, (req, res) => …)`, with an inline arrow as the last argument. Share logic by calling a helper *inside* the arrow, never by passing a factory's return value. After adding a route, prove the guard covers it: remove its `requireAuth` and watch the static test fail, not only the runtime rows.

## Exceptions

Router-mounted sub-apps (`express.Router()` + `app.use(mount, router)` — e.g. the API-key-authed `/api/v1` public API) apply auth at the router level and are invisible to an `app.METHOD` scan. Guard them separately, and assert no *new* `Router()` mount appears in any other module so the scope exclusion fails loudly rather than silently widening.

## Related Files

- `server/routes/__tests__/auth-route-wiring.test.ts` — the guard
- `server/middleware/auth.ts` — real `requireAuth` + `generateToken`
- `server/__tests__/auth.test.ts` — middleware-logic unit tests

## See Also

- [../design-patterns/facade-only-enforced-by-source-grep-guard-test-2026-06-26.md](../design-patterns/facade-only-enforced-by-source-grep-guard-test-2026-06-26.md) — the generic source-grep guard mechanism (call-shape regex + definer allowlist) this applies to auth wiring
- [../code-quality/codeql-missing-rate-limiting-on-auth-test-fixture-2026-06-27.md](../code-quality/codeql-missing-rate-limiting-on-auth-test-fixture-2026-06-27.md) — the real-middleware mount here trips CodeQL `js/missing-rate-limiting`; give the probe a traceable inline limiter
- [pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md](pure-utils-extraction-tests-dont-prove-wiring-2026-07-14.md) — the client-side sibling of this same class of gap: a well-tested extracted pure function doesn't prove the component's effects/mutations wire it correctly
