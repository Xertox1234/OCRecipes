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

## Prevention

- Before widening what reaches an error reporter, construct the worst error that path can carry and run it through the real pipeline.
- If `ExtraErrorData` or `includeLocalVariables` is ever enabled, revisit this scrub.

## Related Files

- `server/lib/error-reporter.ts` — `scrubEvent`
- `server/lib/__tests__/error-reporter.test.ts`

## See Also

- `docs/rules/security.md`
