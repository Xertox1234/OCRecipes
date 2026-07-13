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
last_updated: '2026-07-12'
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
  `event.request`. `sendDefaultPii: false` withholds IP-derived
  `user.ip_address` and related user inference — and, as an SDK-internal
  side effect of that same `requestDataIntegration` (not a documented
  contract), also exact-name-strips a fixed 12-entry `ipHeaderNames` list
  (`x-forwarded-for`, `cf-connecting-ip`, `x-real-ip`, `true-client-ip`,
  etc. — `@sentry/core` `vendor/getIpAddress.js`) straight off
  `event.request.headers` when `include.ip` is false. This is narrower
  than and not a substitute for the manual scrub below: it's an
  implementation detail of one default integration, not a contract, and
  it does nothing for the 19 credential-oriented snippets.
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
- `SENSITIVE_HEADER_SNIPPETS` (`server/lib/error-reporter.ts`) is a
  case-insensitive substring deny-list on header NAMES, verified
  byte-for-byte against the **installed** `@sentry/core`'s own
  `SENSITIVE_KEY_SNIPPETS` (`node_modules/@sentry/node/node_modules/
  @sentry/core/build/cjs/utils/data-collection/filtering-snippets.js`) —
  not the SDK's public API surface or docs, which don't expose this list.
  Sentry's own list is 19 entries (`auth`, `token`, `secret`, `session`,
  `password`, `passwd`, `pwd`, `key`, `jwt`, `bearer`, `sso`, `saml`,
  `csrf`, `xsrf`, `credentials`, `sid`, `identity`, `set-cookie`,
  `cookie`) — a prior pass at this list (2026-07-11, PR #589) only had 6
  of them, despite the docstring already claiming parity. Sentry also
  ships a SEPARATE, narrower `PII_HEADER_SNIPPETS` list — do not conflate
  the two: it is used only for filtering span attributes
  (`httpHeadersToSpanAttributes`), which this module never emits, and has
  no bearing on `event.request` header scrubbing. A THIRD mechanism —
  the default `requestDataIntegration`'s exact-match `ipHeaderNames` list
  (see Root Cause above) — does touch `event.request.headers` directly,
  but only for 12 IP-adjacent names and only as a side effect of
  `sendDefaultPii: false`, not a contract; don't conflate that one either.
  A drift guard (`server/lib/__tests__/error-reporter.test.ts` →
  "SENSITIVE_HEADER_SNIPPETS drift guard") now reads the installed SDK's
  `SENSITIVE_KEY_SNIPPETS` off disk at test time and asserts `scrubEvent`
  strips a header for every entry — the exact prior-silent-drift class
  above now fails a test instead of waiting for the next manual re-diff.
- Referer/Origin header VALUES (not just names) are a live gap ONLY if a
  page that renders a token in its own URL (`GET /verify-email?token=…`,
  `server/lib/verify-email-page.ts`) gains an outbound `http(s)://`
  request (link, asset, redirect, analytics beacon) — that page is
  server-rendered and opened in real browsers TODAY, so "mobile-only
  clients" is not the actual protecting invariant; "zero external
  subresources on that page" is. `Origin` structurally cannot carry a
  token (scheme+host+port only per spec) — do not conflate it with
  `Referer` when reasoning about this gap.

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
  `_helpers.ts → error-reporter` import doesn't tax every route test. This
  alias operates at the bundler (`resolve.alias`) level, BEFORE Vitest's
  mock layer runs — `vi.unmock`/`vi.importActual` cannot recover the real
  package inside a test file; defeating it needs a per-file resolver
  override (e.g. a second Vitest project), which is why no test in this
  codebase exercises the real SDK.
- A process-exit path chained through a bounded async flush
  (`flushErrorReporter(timeoutMs).finally(() => process.exit(1))`,
  `.finally()`-style to avoid an implicit timing coupling between the
  flush call and a separate exit timer) MUST still keep an independent,
  unconditional backstop `setTimeout(() => process.exit(1), N)` running in
  parallel. The flush promise's bound is a third-party SDK's internal
  contract, not one this codebase controls — `Sentry.flush(timeoutMs)`
  (`@sentry/core` `client.js`) sequentially awaits
  `_isClientDoneProcessing(timeoutMs)` THEN `transport.flush(timeoutMs)`,
  each independently bounded, so the REAL worst case is ~2x the passed
  timeout, not the timeout value itself — a comment or backstop timer that
  assumes the passed value is a strict ceiling is quietly wrong. Set the
  backstop above that realistic worst case (e.g. 1000ms for a 400ms flush
  call) so it fires only on a genuine hang. This mirrors the pattern this
  codebase already uses for its graceful-shutdown exit path
  (`server/index.ts`'s `shutdown()`: a chained `.finally()` through
  `flushErrorReporter`/`pool.end()`, PLUS an independent
  `setTimeout(..., 10_000)` force-exit backstop) — the crash path
  (`uncaughtException`) needs the same two-tier shape, not just the
  chain half of it. Separately: `flushErrorReporter` resolves INSTANTLY
  when the reporter is inactive (dev, or prod without `SENTRY_DSN`) — a
  bare `.finally()` on an already-resolved promise fires on the next
  microtask, i.e. near-immediately, which can truncate a genuinely async
  log transport (e.g. dev's `pino-pretty` worker-thread transport) that a
  prior unconditional delay gave time to drain. Race the flush against a
  `minDelay` timer (`Promise.all([flush, minDelay]).finally(...)`) to
  restore that floor on the inactive path too.

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
