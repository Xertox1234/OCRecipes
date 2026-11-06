---
title: "A route catch that hand-builds its 500 never reaches Sentry — handleRouteError is the handled-5xx report chokepoint"
track: bug
category: logic-errors
tags: [api, express, sentry, error-handling, observability, handleRouteError]
module: server
symptoms: ["a route returns 500 in production but no Sentry issue ever appears", "a catch block does logger.error + sendError(res, 500, ...) itself instead of handleRouteError", "a service's typed error is turned into a 500 whose body echoes error.message", "best-effort cleanups end in .catch(() => undefined) or .catch(() => []) and fail without a trace"]
created: 2026-11-05
severity: medium
---

# A route catch that hand-builds its 500 never reaches Sentry — handleRouteError is the handled-5xx report chokepoint

## Problem

Our routes answer errors themselves and never call `next(err)`, so Sentry's Express error handler never sees them. The only place a handled 5xx is reported is `handleRouteError` (`server/routes/_helpers.ts`), which logs, calls `reportError`, and sends `Failed to <context>`. A catch block that writes its own `logger.error(...)` + `sendError(res, 500, …)` skips that call: the failure is in the server log and nowhere else.

The 2026-11-05 code-quality audit found four routes doing this (meal confirm, voice transcribe, toggle-favourite, cooking photo analysis) plus three best-effort cleanups and one AI-output parse that swallowed errors with no log at all.

## Symptoms

- A 500 visible to the client with no Sentry issue.
- `sendError(res, 500, …)` inside a `catch` in `server/routes/**`.
- A typed service error mapped to 500 with `error.message` as the body — internal detail leaks and nothing is reported.
- `.catch(() => undefined)` / `.catch(() => [])` on a cleanup or lookup — "best effort" with no trace when it keeps failing.

## Root Cause

Log level is the Sentry routing decision (`pinoIntegration` ships `error` only), but a handled route error needs more than a log line: `reportError` is what files it. Hand-built 500s were written before (or alongside) the chokepoint, and each one is a silent hole. Swallow-to-a-value catches look deliberate ("best effort") so they survive review, but they make repeated failure undetectable.

## Solution

- Route catch → `handleRouteError(res, error, "<context>")`. Keep any non-500 branch (e.g. `isUniqueViolation` → 409) before it.
- If the route must keep a specific code (`TOGGLE_FAILED`), respond directly but call `reportError(error, "<context>")` — the same duty `handleRouteError` carries.
- A typed service error that only exists to pick a message: delete the special case and let it fall through to the outer `handleRouteError` (fixed message, logged, reported). Check the client never reads the old message first (`useCookSession.ts` builds its own).
- Best-effort side effects stay non-fatal but log at `warn` with `err: toError(err)` (warn = server log, not Sentry).
- Tests assert on the call records (`reportError` / logger mocks), not on the response body — the body was already a 500 before the fix.

## Prevention

- `server-reviewer` checklist: a direct-response route catch must call `reportError`; value-returning swallow catches (`() => undefined`, `() => []`, `() => null`) need a warn log.
- `docs/rules/api.md` already requires `handleRouteError` in every catch; this file is the "why".

## Related Files

- `server/routes/_helpers.ts` (`handleRouteError`)
- `server/routes/meal-plan.ts`, `food.ts`, `nutrition.ts`, `cooking.ts`, `inspired-recipes.ts`
- `server/services/coach-blocks.ts`, `server/services/voice-transcription.ts` (`{ cause }` on rethrow)

## See Also

- `docs/solutions/conventions/server-log-level-is-the-sentry-routing-decision-2026-10-30.md`
- `docs/solutions/logic-errors/handled-logger-error-never-reaches-sentry-without-pino-integration-2026-10-30.md`
