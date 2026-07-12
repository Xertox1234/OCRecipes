---
title: "@sentry/node: sendDefaultPii: false still ships request bodies, headers, cookies, and query strings"
track: bug
category: logic-errors
tags: [sentry, observability, security, pii, server, express, error-tracking]
module: server
applies_to: [server/lib/error-reporter.ts, server/lib/error-reporter-boot.ts, server/routes/_helpers.ts, server/index.ts]
symptoms: ["Sentry events contain request bodies with passwords or health data despite sendDefaultPii: false", "bearer JWTs / x-api-key / cookie headers visible on Sentry error events", "verify-email token or API-key query strings appear in Sentry event URLs and breadcrumbs", "handled 500s from handleRouteError never appear in Sentry at all"]
severity: critical
created: '2026-07-11'
---

# @sentry/node: sendDefaultPii: false still ships request bodies, headers, cookies, and query strings

## Problem

A server-side Sentry integration (@sentry/node v10) that relies on
`sendDefaultPii: false` plus an exact-name `authorization` header scrub —
mirroring the client's `client/lib/reporter.ts` pattern — still egresses
compliance-grade PII to Sentry: plaintext passwords from auth-route bodies,
user health data from coach/profile bodies, `x-api-key` B2B credentials,
cookies, client IPs, live `verify-email?token=…` URLs, and third-party API
keys in outbound-request breadcrumb query strings.

## Symptoms

- Sentry events carry `event.request.data` (up to 10KB of raw request body)
  even though `sendDefaultPii: false` is set.
- ALL request headers attach raw to error events — `x-api-key`, `cookie`,
  `x-forwarded-for` included — despite the SDK having a sensitive-key
  deny-list (it filters span attributes only, never `event.request`).
- `event.request.url` / `query_string` include token-bearing queries;
  http breadcrumbs include `data["http.query"]` with upstream API keys.
- Separately: handled 5xx routed through `handleRouteError` → `sendError`
  never reach `Sentry.setupExpressErrorHandler` at all (the convention
  responds directly and never calls `next(err)` — 164 call sites, 0
  `next(err)` sites), so "production 5xx tracking" silently only covers
  escaped/unhandled errors.

## Root Cause

Verified against installed `@sentry/node` 10.65.0 source, not docs:

- The default `httpIntegration` captures incoming request bodies onto the
  isolation scope with `maxRequestBodySize` defaulting to `"medium"` (10KB)
  — there is NO `sendDefaultPii` gate on that path (`@sentry/core`
  `integrations/http/server-subscription.js`).
- `requestDataIntegration` attaches the buffered body, all raw headers,
  parsed cookies, raw `query_string`, and the full URL to every error
  event. The SDK's `SENSITIVE_KEY_SNIPPETS` filtering applies **only to
  span attributes** (`httpHeadersToSpanAttributes`), never to
  `event.request`. `sendDefaultPii: false` only withholds IP-derived
  `user.ip_address` and related user inference.
- Outbound http/fetch breadcrumbs attach the raw query string as
  `data["http.query"]` (`@sentry/node-core` `outgoingFetchRequest.js`).
- Express-handler capture only fires on `next(err)` forwarding; a codebase
  whose route convention responds directly (`handleRouteError`) bypasses it.

## Solution

`server/lib/error-reporter.ts` (single Sentry import point, DSN-gated,
production-only) implements the real controls:

- `Sentry.httpIntegration({ maxIncomingRequestBodySize: "none" })` in
  `integrations` — same-name integration replaces the default, so bodies
  are never even buffered.
- `beforeSend` scrub (`scrubEvent`): snippet-match header deny-list
  (`auth`, `token`, `key`, `secret`, `session`, `cookie`, plus IP headers
  `forwarded`, `real-ip`, `connecting-ip`, `client-ip` — client IPs are
  GDPR/CCPA PII and NOT withheld by `sendDefaultPii: false`), deletes
  `request.data` / `request.cookies` / `request.query_string`, strips the
  query from `request.url`, and strips `http.query` / `http.fragment` /
  url queries from breadcrumbs. requestId + path is enough for pino
  correlation.
- Handled 5xx chokepoint: `handleRouteError`'s 500 branch calls the
  module's `reportError(error, context)` (which runs the same beforeSend
  pipeline) — the Express handler (`Sentry.setupExpressErrorHandler`,
  registered after routes / before the JSON error handler) only covers
  errors that escape.
- `onUncaughtExceptionIntegration({ exitEvenIfOtherHandlersAreRegistered:
  false })` so the app's `uncaughtException` handler keeps owning the
  log/flush/exit sequence; bounded `Sentry.flush` in both the crash and
  graceful-shutdown exit paths.

## Prevention

- Never trust an SDK PII flag by name — verify what it actually gates
  against the **installed** source before calling a scrub
  "defense-in-depth". Here the beforeSend scrub is the load-bearing
  control, not a belt-and-suspenders extra.
- When adding any error/telemetry capture to this server, route it through
  `server/lib/error-reporter.ts` (single point of contact) so the rate cap
  + scrub pipeline always applies; never call `Sentry.*` directly.
- Remember the routing convention: handled 5xx never hit Express error
  middleware — new capture sinks need the `handleRouteError` chokepoint,
  not just an error-middleware hook.
- Test-suite cost: `@sentry/node` costs ~500ms to import (OTel tree);
  `vitest.config.ts` aliases it to `test/mocks/sentry-node.ts` so the
  `_helpers.ts → error-reporter` import doesn't tax every route test.

## Related Files

- `server/lib/error-reporter.ts` — DSN-gated reporter; scrub pipeline, rate cap, chokepoint `reportError`
- `server/lib/error-reporter-boot.ts` — side-effect init; MUST stay the second import in `server/index.ts`
- `server/routes/_helpers.ts` — `handleRouteError` 500 branch calls `reportError`
- `server/index.ts` — Express handler ordering + crash/shutdown flush
- `test/mocks/sentry-node.ts` — vitest alias stub
- `server/lib/__tests__/error-reporter.test.ts` — scrub/gating/cap/ordering tests

## See Also

- [DSN-gated Sentry reporter pattern for Expo / React Native](../conventions/sentry-dsn-gated-reporter-pattern-2026-05-31.md) — the client twin; its `sendDefaultPii` comment describes react-native SDK behavior, not @sentry/node v10
- [Process-level uncaughtException and unhandledRejection handlers](../conventions/process-level-error-handlers-2026-05-13.md) — the exit-ownership contract the integration options preserve
- [PII stripping in API response serialization](../design-patterns/pii-stripping-api-response-serialization-2026-05-13.md) — same allowlist-over-blocklist instinct at a different boundary
