---
title: "A log field next to the mixin's user id is a per-user record — keep what the user scanned, ate or typed out of info, warn and error lines"
track: knowledge
category: conventions
tags: [security, api, architecture, logging, pino, privacy]
module: server
applies_to: ["server/services/**/*.ts", "server/routes/**/*.ts", "server/lib/logger.ts"]
symptoms: ["a service log line carries a barcode, food name or search text and reads as harmless because the call site passes no user id", "a privacy fix removed an identifier from one log line and the same field is still on the warn and error lines of the same file"]
created: 2026-11-14
---

# A log field next to the mixin's user id is a per-user record

## Rule

In `server/`, an `info`, `warn` or `error` log line must not carry a field that names what the
user scanned, ate or typed: a barcode, a food or product name, search text. Log the outcome
instead (which source answered, a status code, a cache hit, a count).

`debug` lines may keep such a field. Production runs at `info` unless `LOG_LEVEL` says otherwise
(`server/lib/logger.ts`), so a debug line is not written there.

## Why

The call site never passes a user id, so a line like `log.warn({ barcode }, "lookup failed")`
looks anonymous. It is not. The root logger's `mixin()` reads the request context and adds
`requestId` and `userId` to every line logged during a request, including lines from child
loggers made with `createServiceLogger`. The stored line is `{ userId, barcode, ... }`: a record
of what one person scanned, kept for as long as the log host keeps logs.

A barcode identifies a product, and products can reveal health facts (a glucose monitor strip, a
pregnancy supplement, an allergy medicine).

## Examples

Before (#1870 removed these from `server/services/barcode-lookup.ts` and
`server/routes/verification.ts`):

```ts
log.warn({ err: toError(err), variant }, "Open Food Facts fetch error");
log.error({ barcode: code, secondarySource, secondaryPer100g }, message);
```

After:

```ts
log.warn({ err: toError(err) }, "Open Food Facts fetch error");
log.error({ secondarySource, secondaryPer100g }, message);
log.debug({ barcode: code, term }, "trying CNF lookup"); // debug: not written in production
```

When sweeping a file for one identifier, sweep by the field across every level, not by the line
the report named: #1870 found the barcode on six lines at `info` or above and a `variant` field
(a rewritten form of the same barcode) on two more.

## Exceptions

- `requestId` is the way to join a line to a request when support needs it; it is added
  automatically and is not user content.
- An error object's own message can carry the value (a fetch error that includes the URL). That is
  not covered by removing the field and was not verified in #1870.

## Related Files

- `server/lib/logger.ts` — the `mixin()` and `createServiceLogger`
- `server/services/barcode-lookup.ts`, `server/routes/verification.ts` — the lines #1870 changed

## See Also

- [Sentry pinoIntegration ships the whole log line](../logic-errors/pino-integration-ships-whole-log-line-and-drizzle-params-to-sentry-2026-10-30.md) — the same fields leaving the server on `error` lines
- [Server log level is the Sentry routing decision](server-log-level-is-the-sentry-routing-decision-2026-10-30.md)
