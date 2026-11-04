---
title: "Sentry pinoIntegration ships the whole log line (contexts.pino) and Drizzle query params to Sentry"
track: bug
category: logic-errors
tags: [security, architecture, sentry, observability, pino, pii, drizzle, error-tracking]
module: server
applies_to: [server/lib/error-reporter.ts, server/lib/logger.ts, server/services/**/*.ts, server/routes/**/*.ts, server/storage/**/*.ts]
symptoms: ["A Sentry event's Additional Data shows a `pino` context with userId, recipient `to` emails, provider error bodies or barcode/food fields", "A Sentry exception value reads `Failed query: select ... \\nparams: someone@example.com,...`", "A log field that was safe in the Railway log stream now appears off-box in Sentry"]
severity: high
created: '2026-10-30'
---

# Sentry pinoIntegration ships the whole log line (contexts.pino) and Drizzle query params to Sentry

## Problem

Wiring `Sentry.pinoIntegration({ error: { levels: ["error"] } })` (see
[handled logger.error never reaches Sentry](handled-logger-error-never-reaches-sentry-without-pino-integration-2026-10-30.md))
turns every `logger.error` into a Sentry event. That made two existing data
flows leave the box for the first time:

1. The integration attaches the **entire** pino record, minus `err` and plus
   `msg`, as `event.contexts.pino` — mixin bindings (`requestId`, `userId`),
   child-logger bindings, and every ad-hoc field a call site logs (`to`
   recipient addresses, Resend error bodies, food names, barcodes).
2. Drizzle's `DrizzleQueryError` message is
   `` `Failed query: ${query}\nparams: ${params}` ``
   (`node_modules/drizzle-orm/errors.js`). The SQL uses `$n` placeholders, but
   the params are user data. Any logged DB failure ships that message as
   `exception.values[].value`.

Neither path is covered by the request-side scrub in `scrubEvent` (headers,
body, query string, breadcrumbs), and `sendDefaultPii: false` gates neither.

## Symptoms

- `contexts.pino` on a Sentry event holds keys like `userId`, `to`,
  `resendError`, `barcode`.
- An exception value contains `\nparams:` followed by emails or other row
  values.

## Root Cause

Logs and telemetry have different trust boundaries. Call sites were written
for a log stream that stays on Railway, so they log freely. A bridge that
forwards log records to a third party inherits every one of those fields, and
the pinoIntegration copies the record wholesale
(`node_modules/@sentry/node-core/build/cjs/integrations/pino.js`: every key
except `errorKey`/`messageKey` goes into `pinoContext`).

## Solution

In `server/lib/error-reporter.ts` → `scrubEvent` (the `beforeSend` hook):

- **Allowlist, not denylist, `contexts.pino`.** `PINO_CONTEXT_ALLOWLIST` =
  `msg`, `requestId`, `service`, `operation`, `kind`. Every other key is
  deleted. `requestId` alone correlates the event back to the full pino line.
  `userId` is dropped on purpose, matching `sendDefaultPii: false`. A
  denylist would silently leak the next ad-hoc field someone logs.
- **Cut the Drizzle params tail.** `scrubEvent` cuts every
  `event.exception.values[].value` at `"\nparams:"` (keeps the placeholder
  SQL, drops the values). That scrub and its test are owned by
  [DrizzleQueryError messages carry bound parameters](drizzle-query-error-message-carries-bound-params-to-sentry-2026-10-29.md)
  (#1621); pinoIntegration only widened which errors reach it — every
  logged DB failure, not just reported ones.
- **Do not put user data in an Error message you build yourself.** The
  `resendFailure` Error in `server/services/email.ts` uses only
  `resend <name> (<statusCode>)`; Resend's free-text message stays in the
  log under `resendError`.

The Drizzle error's `cause` (the `pg` error) also reaches Sentry: the SDK's
default `linkedErrorsIntegration` sends it as its own exception value. `pg`
keeps row values of constraint errors (23505) in `detail`, which is not
shipped because `extraErrorDataIntegration` is off, but it puts the rejected
input in the MESSAGE for type, enum and date errors
(`invalid input syntax for type uuid: "<input>"`, 22P02 / 22007). `scrubEvent`
therefore also redacts any quoted tail after `: "` in every exception value,
plus three shapes that quote the input mid-message: `value "<input>" is out of
range for type …` (22003), `time zone "<input>" not recognized` (22023) and
`invalid value "<input>" for "<fmt>"` (22007 from `to_date`/`to_timestamp`).
Each is cut greedily up to its fixed suffix, so a quote inside the input
cannot end the redaction early. Quoted identifiers in other messages
(`relation "users" does not exist`) are kept. A new pg message shape that
quotes user input needs its own pattern and test row. Measured 2026-11-03 with a real `Sentry.init` probe before the fix:
the input survived the `\nparams:` cut.

## Prevention

- Before adding a key to `PINO_CONTEXT_ALLOWLIST`, confirm it can never carry
  PII (user ids, emails, free text, food or health data). If it can, leave it
  out; the requestId is enough to find it in the log.
- `cause` is already serialized by the default `linkedErrorsIntegration` —
  check every exception value, not only the primary one. Never enable
  `extraErrorDataIntegration` (which ships `detail`) without extending
  `scrubEvent`.
- Any new log-to-telemetry bridge (a Sentry Logs `enableLogs`, another
  integration) needs its own scrub. Treat it as a new trust boundary, not a
  copy of the log stream.

## Related Files

- `server/lib/error-reporter.ts` — `PINO_CONTEXT_ALLOWLIST`, `scrubEvent`
- `server/lib/__tests__/error-reporter.test.ts` — allowlist scrub test
- `server/services/email.ts` — `resendFailure` (PII-free Error message)

## See Also

- [DrizzleQueryError messages carry bound parameters](drizzle-query-error-message-carries-bound-params-to-sentry-2026-10-29.md) — owner of the `\nparams:` scrub

- [Handled logger.error never reaches Sentry without pinoIntegration](handled-logger-error-never-reaches-sentry-without-pino-integration-2026-10-30.md) — the integration that opened this path
- [@sentry/node sendDefaultPii: false still ships request PII](sentry-node-senddefaultpii-false-still-ships-request-pii-2026-07-11.md) — the request-side half of the same scrub
- [PII stripping in API response serialization](../design-patterns/pii-stripping-api-response-serialization-2026-05-13.md) — same allowlist-over-denylist instinct
