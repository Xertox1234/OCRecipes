---
title: "Handled server failures (logger.error) never reach Sentry without a configured pinoIntegration"
track: bug
category: logic-errors
tags: [architecture, api, sentry, observability, pino, logging, fire-and-forget, error-tracking]
module: server
applies_to: [server/lib/error-reporter.ts, server/lib/fire-and-forget.ts, server/lib/logger.ts, server/services/email.ts, server/routes/chat.ts, test/mocks/sentry-node.ts]
symptoms: ["A background job, cron catch or SSE stream fails in prod and the Railway log shows `logger.error`, but Sentry has no event", "Sentry only ever shows uncaught crashes and handleRouteError 500s", "Sentry.pinoIntegration() was added but still no logger.error events arrive", "A logger.error event arrives in Sentry as a bare message with no stack or exception type"]
severity: high
created: '2026-10-30'
---

# Handled server failures (logger.error) never reach Sentry without a configured pinoIntegration

## Problem

The server's Sentry wiring (`server/lib/error-reporter.ts`) captured only three
paths: uncaught exceptions, unhandled rejections, and the `handleRouteError`
500 chokepoint (`reportError`). Every failure the code _handles_ — the
`fireAndForget` `.catch`, the retention / reminder / cache-cleanup /
canonical-promotion cron catches, the SSE chat-stream catch, the nine Resend
send-failure logs — logs with `logger.error` and swallows. None of those ever
became a Sentry event, so the whole class of background and streaming
failures was visible only to someone already reading the log stream
(reliability audit 2026-10-30, N6 / R39 / R40 / R41).

## Symptoms

- A failure is plainly in the pino log at level `error`, but Sentry is empty.
- Sentry's issue list contains only crashes and route 500s.
- Adding `Sentry.pinoIntegration()` with no options changes nothing for
  errors.
- A `logger.error({ resendError }, "…")` event, once captured, is a
  `captureMessage` with no stack and no exception type to group by.

## Root Cause

- "Log and swallow" is the project's handled-failure convention, and
  `onUnhandledRejection` by definition never sees a rejection that was
  `.catch`-ed. Nothing bridged the logger to the reporter.
- `@sentry/node-core`'s `pinoIntegration` (10.65.0,
  `node_modules/@sentry/node-core/build/cjs/integrations/pino.js`) defaults to
  `error: { levels: [] }` — with no options it captures **no** error events;
  its default `log.levels` only matter when `enableLogs` is set (it is not).
- The integration subscribes to pino's `pino_asJson` diagnostics tracing
  channel and calls `captureException(record[errorKey])` **only when the
  `err` key holds a value**; otherwise it falls back to
  `captureMessage(msg)`. A call site that logs a non-Error SDK object under a
  different key (`resendError`) therefore gets a stackless message event.

## Solution

- `initErrorReporter` adds
  `Sentry.pinoIntegration({ error: { levels: ["error"] } })`. Error level
  only: `warn` stays log-only, and `enableLogs` is never set, so the log
  levels stay inert. Events still pass `beforeSend` (rate cap + `scrubEvent`).
  An Error logged by `handleRouteError` AND passed to `reportError` is
  captured once — the SDK marks a captured Error and skips repeats.
- Call sites that already followed the convention (`logger.error` with
  `err: toError(err)`) needed no change: `fireAndForget`, the cron catches,
  the `"chat streaming error"` and `"failed to settle aborted coach turn"`
  logs. The client-disconnect branch of the chat stream stays at `debug`, so
  it never pages.
- Resend failures keep the raw `resendError` fields AND add
  `err: resendFailure(error)` — an `Error` named `ResendError` whose message
  is only `resend <name> (<statusCode>)`. That gives Sentry a fingerprintable
  exception while Resend's free-text message (which can echo the recipient)
  stays in the log.
- The pino side is tested without the real SDK (it is aliased to
  `test/mocks/sentry-node.ts`, which gained a `pinoIntegration` stub): subscribe
  to `diagnosticsChannel.tracingChannel("pino_asJson").end` and assert the
  record's level label is `"error"` and `args[0].err` is the original `Error`
  (`server/lib/__tests__/fire-and-forget.test.ts`). `test/setup.ts` silences
  the logger, and a silenced level never serializes, so the test must set
  `logger.level = "error"` and restore it.

## Prevention

- At a `logger.error` site, `err` must hold a real `Error` — `toError(err)`
  for a thrown value, a purpose-built Error (like `resendFailure`) for an
  SDK's returned error object. Logging the object under another key alone
  produces a stackless Sentry message.
- Pick the level as a routing decision: `error` pages Sentry, `warn` does
  not. See
  [server log level is the Sentry routing decision](../conventions/server-log-level-is-the-sentry-routing-decision-2026-10-30.md).
- Verify an SDK integration's _default options_ against the installed source
  before assuming that adding it is enough — here the default captured nothing.
- Every new key logged at `logger.error` reaches `scrubEvent`; see
  [pinoIntegration ships the whole log line](../logic-errors/pino-integration-ships-whole-log-line-and-drizzle-params-to-sentry-2026-10-30.md)
  for the allowlist that keeps it from leaving the box.

## Related Files

- `server/lib/error-reporter.ts` — `initErrorReporter` integration list
- `server/lib/fire-and-forget.ts` — the canonical `err: toError(err)` shape
- `server/services/email.ts` — `resendFailure`
- `server/lib/__tests__/fire-and-forget.test.ts` — `pino_asJson` channel contract test
- `server/routes/__tests__/chat.test.ts` — stream-failure level guard
- `test/mocks/sentry-node.ts` — vitest alias stub

## See Also

- [pinoIntegration ships the whole log line and Drizzle params](pino-integration-ships-whole-log-line-and-drizzle-params-to-sentry-2026-10-30.md) — the scrub this integration required
- [@sentry/node sendDefaultPii: false still ships request PII](sentry-node-senddefaultpii-false-still-ships-request-pii-2026-07-11.md) — the reporter's original capture paths and scrub pipeline
- [Error-coercion helper flattens non-Error SDK objects](../code-quality/non-error-sdk-object-flattened-by-error-coercion-helper-2026-06-22.md) — why `resendError` is logged raw beside `err`
