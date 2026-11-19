---
title: "An SDK upgrade can turn on a new data channel by default — a config that lists only what you want ON says nothing about it"
track: bug
category: logic-errors
tags: [security, architecture, sentry, observability, pino, pii, dependencies]
module: server
applies_to: [server/lib/error-reporter.ts, server/lib/logger.ts, package.json]
symptoms: ["Sentry's Logs view fills with server log lines (start-up messages, request lines) although the config never enabled logs", "A telemetry SDK bump is lockfile-only and every test stays green", "A capture of what the SDK sends contains an item type (log, span, metric) the config does not mention"]
severity: high
created: '2026-11-18'
---

# An SDK upgrade can turn on a new data channel by default — a config that lists only what you want ON says nothing about it

## Problem

`@sentry/core` 10.78.0 changed the default of `enableLogs` to true
(`client.js`: `enableLogs ?? ... ?? true`). With `pinoIntegration` installed,
every pino line at every level, with all its fields (`userId`, `requestId`,
ad-hoc call-site fields), was then sent to Sentry as a Log. Production shipped
about 1,000 lines over roughly nine days before it was noticed.

The server's Sentry config was correct for the channel it knew about: events
went through `beforeSend` and an allowlist scrub. Logs are a separate channel.
They never pass through `beforeSend`, and the config did not mention them, so
the new default applied in full.

## Symptoms

- Sentry → Explore → Logs shows server log lines for a project whose config
  has no `enableLogs`.
- The in-range bump that caused it changed only `package-lock.json`.
- No test failed: the tests pinned the options the config set, not the options
  it left unset.

## Root Cause

A config written as "turn on what I want" is silent about everything else, and
a library is free to change what "everything else" means in a minor release.
Review reads the diff, and the diff was a lockfile line. CI runs the tests,
and no test asserted the absence of a channel.

## Solution

In `server/lib/error-reporter.ts` → `buildSentryOptions` (#1920, on
`@sentry/node` 11):

- Every `dataCollection` field is written out and set off, apart from request
  headers, which the scrub then filters.
- Logs have two locks: `pinoIntegration({ log: { levels: [] } })` stops the
  integration producing them, and `beforeSendLog: () => null` drops any that
  another source produces.
- `server/lib/__tests__/error-reporter.test.ts` pins the full `dataCollection`
  object, `log.levels: []`, and that `beforeSendLog` returns null.

## Prevention

On any bump of an SDK that sends data off the box (Sentry, analytics, an AI
provider client):

1. **Read the release notes for new defaults, not only for breaking changes.**
   A new default is not listed as breaking.
2. **Pin every data-collection option explicitly, including the ones you want
   off**, and assert the whole options object in a test so a new field shows up
   as a decision.
3. **Capture what actually leaves the process.** Build the server the way
   production builds it, give the SDK a fake DSN and a capturing transport, and
   list the item types sent (event, log, span, …). An unexpected type is the
   finding, whatever it contains.

### Making the capture trustworthy

Two mistakes from the #1920 probe:

- **Build canary strings at runtime.** A canary written as a literal in the
  probe's own source was "found" in the output, because the SDK attaches source
  lines around each stack frame. Concatenate the canary from parts so it exists
  only as a runtime value.
- **Every canary needs a positive control.** Run once with scrubbing off and
  check that each canary appears. Six of ten did not appear even then, so their
  absence under the real options proved nothing about them. Report "0 of the 4
  that the control showed", not "0 of 10".

## Related Files

- `server/lib/error-reporter.ts` — `buildSentryOptions`, `scrubEvent`
- `server/lib/__tests__/error-reporter.test.ts`

## See Also

- [pinoIntegration ships the whole log line](pino-integration-ships-whole-log-line-and-drizzle-params-to-sentry-2026-10-30.md) — the event-side version of the same leak
- [sendDefaultPii: false still ships request PII](sentry-node-senddefaultpii-false-still-ships-request-pii-2026-07-11.md) — another default that did less than its name said
- [verify lockfile churn semantically](../conventions/verify-lockfile-churn-semantically-not-by-diff-line-count-2026-06-23.md) — a one-line lockfile diff can carry a behaviour change
