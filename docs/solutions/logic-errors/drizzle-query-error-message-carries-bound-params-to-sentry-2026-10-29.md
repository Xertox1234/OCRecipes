---
title: A Drizzle query error's message ends with every bound value — reporting it to Sentry ships password hashes and health text unless the scrubber cuts at "\nparams:"
track: bug
category: logic-errors
module: server
severity: high
tags: [security, privacy, sentry, drizzle, error-reporting, pii, health-data]
symptoms: ["Sentry event exception value contains 'params:' followed by query values", "a failed password-hash write would send both hashes off the server"]
applies_to: [server/lib/error-reporter.ts, server/lib/fire-and-forget.ts]
created: '2026-10-29'
last_updated: 2026-11-16
---

# DrizzleQueryError messages carry bound parameters

## Problem

drizzle-orm 0.45 wraps every failed query as `DrizzleQueryError` with the message `Failed query: <sql>\nparams: <every bound value>` (`node_modules/drizzle-orm/errors.js`). The Sentry `scrubEvent` cleaned request bodies, headers, query strings and breadcrumbs — but not exception messages. `handleRouteError` already reported route-level query errors; routing `fireAndForget` failures to `reportError` widened it to background writes such as the password rehash and the coach response cache.

## Symptoms

- A captured event's `exception.values[0].value` reads `…\nparams: pv2$…,user-uuid,$2b$…`.

## Root Cause

Scrubbers are usually written for the request (where PII is expected) and forget that an error MESSAGE can embed data too. Drizzle's message is designed for local debugging.

## Solution

In `scrubEvent`, cut every `event.exception.values[].value` at `"\nparams:"` — this keeps the query text and covers linked causes (LinkedErrors adds the cause as another entry). Verified through a real `Sentry.init` + `beforeSend` probe with a control (unscrubbed: secret present; scrubbed: absent). `ExtraErrorData` is not a default integration, so the error's own `params` property is not serialized; console breadcrumbs would carry it, but the server logs through pino (stdout), not `console`.

## Not covered: the server log

`scrubEvent` protects what reaches Sentry. The pino log line is separate: `handleRouteError` logs `err: toError(error)` unchanged, so a failed statement's bound values still land in the server log next to the user id. Found by the security review of the family profile routes (2026-11-16), where those values are another person's name, allergies and note.

Until the logger redacts them for every route (`todos/P2-2026-11-16-server-log-drizzle-params-carry-health-data.md`), a route that writes health data wraps the error before `handleRouteError`: `withoutBoundValues` in `server/routes/family.ts` cuts the message at `"\nparams:"` and drops the `cause`, and leaves a `ZodError` untouched so validation still answers 400. `server/routes/__tests__/family.log-redaction.test.ts` pins it, with a control that its detector sees the values in an unredacted error.

## Prevention

- Before widening what reaches an error reporter, construct the worst error that path can carry and run it through the real pipeline.
- If `ExtraErrorData` or `includeLocalVariables` is ever enabled, revisit this scrub.

## Related Files

- `server/lib/error-reporter.ts` — `scrubEvent`
- `server/lib/__tests__/error-reporter.test.ts`
- `server/routes/family.ts` — `withoutBoundValues`; `server/routes/__tests__/family.log-redaction.test.ts`

## See Also

- `docs/rules/security.md`
- [pinoIntegration ships the whole log line](pino-integration-ships-whole-log-line-and-drizzle-params-to-sentry-2026-10-30.md) — every `logger.error` now reaches this scrub too, and the `contexts.pino` allowlist
