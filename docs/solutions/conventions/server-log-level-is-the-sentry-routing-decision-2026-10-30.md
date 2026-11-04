---
title: "Server log level is the Sentry routing decision: error pages, warn does not, and nothing is silent"
track: knowledge
category: conventions
tags: [architecture, api, observability, logging, sentry, pino, error-handling]
module: server
applies_to: [server/routes/**/*.ts, server/services/**/*.ts, server/lib/**/*.ts, server/storage/**/*.ts]
symptoms: ["`.catch(() => {})` on a server side effect", "`catch { /* best-effort */ }` with no log", "A best-effort cleanup failure logged at `error` (pages Sentry for a non-incident)", "`logger.error({ someSdkError }, ...)` with no `err` key", "A fallback that returns the same empty result whether the check ran or failed"]
created: '2026-10-30'
---

# Server log level is the Sentry routing decision: error pages, warn does not, and nothing is silent

## Rule

Since `Sentry.pinoIntegration({ error: { levels: ["error"] } })` is wired in
`server/lib/error-reporter.ts`, choosing a pino level on the server decides
whether a failure becomes a Sentry event:

- **`logger.error`** is for a failure someone should act on: a background job,
  cron or stream failing, a provider send failing. `err` must hold a real
  `Error`: `toError(err)` for a thrown value, a purpose-built Error for an
  SDK's returned error object (`resendFailure` in `server/services/email.ts`).
  Without an `err` Error the event is a stackless message.
- **`logger.warn`** is for a best-effort side effect whose failure leaves the
  main operation intact: cache seeding, a stale-token delete, an upload
  rollback. Log it with `err: toError(err)` and the ids you need, but keep it
  out of Sentry.
- **Never silent.** No `.catch(() => {})` and no empty `catch {}` on a server
  side effect. A systematic fault (schema drift, revoked credentials) in a
  best-effort path is otherwise invisible forever.
- **Degraded is not empty.** When a fallback swallows a failed check, the
  response must say the check failed (a flag such as `allergenCheckFailed`)
  rather than returning the same empty result as "checked, nothing found".
  This matters most for safety signals: an empty allergen list reads as safe.
- Expected noise stays below `warn`: the chat stream's client-disconnect
  branch logs at `debug`.

## Why

Before the integration, every handled failure was log-only and the level was
cosmetic. Now `error` pages and every key on the record reaches `scrubEvent`.
Over-logging at `error` buries real incidents and spends the reporter's rate
cap; under-logging (silent catches) hides systematic faults. Reliability audit
2026-10-30 found both: silent handlers in `photos.ts` label cache seeding,
`push-notifications.ts` stale-token delete and the `auth.ts` avatar rollback
(R46), and a cooking-photo allergen catch that returned `[]` on failure (R44).

## Examples

```ts
// best-effort side effect — warn, never silent
await storage.deletePushToken(userId, token).catch((err: unknown) => {
  logger.warn({ err: toError(err), userId }, "push-notifications: stale token delete failed");
});

// degraded result is flagged, not disguised as empty
let allergenCheckFailed = false;
try { allergenWarnings = detectAllergens(names, allergies); }
catch (error) {
  allergenCheckFailed = true;
  logger.warn({ err: toError(error), sessionId }, "cooking photo: allergen check failed");
}
res.json({ ..., allergenWarnings, allergenCheckFailed });

// SDK returns a plain error object — keep its fields AND give Sentry an Error
if (error) logger.error({ resendError: error, err: resendFailure(error) }, "reset code email failed");
```

## Exceptions

- Route catch blocks still go through `handleRouteError` (`docs/rules/api.md`);
  its 500 branch already reports via `reportError`, and the SDK de-dupes an
  Error captured both ways.
- Fields you add at `error` level do not reach Sentry unless they are in
  `PINO_CONTEXT_ALLOWLIST`, and must not be added there if they can carry PII.

## Related Files

- `server/lib/error-reporter.ts` — `pinoIntegration` config, `PINO_CONTEXT_ALLOWLIST`
- `server/lib/fire-and-forget.ts` — canonical `logger.error` + `err: toError(err)`
- `server/services/email.ts` — `resendFailure`
- `server/routes/cooking.ts` — `allergenCheckFailed`
- `server/routes/photos.ts`, `server/services/push-notifications.ts`, `server/routes/auth.ts` — warn-level best-effort handlers

## See Also

- [Handled logger.error never reaches Sentry without pinoIntegration](../logic-errors/handled-logger-error-never-reaches-sentry-without-pino-integration-2026-10-30.md) — why the level now routes
- [pinoIntegration ships the whole log line](../logic-errors/pino-integration-ships-whole-log-line-and-drizzle-params-to-sentry-2026-10-30.md) — what scrubEvent keeps from an error-level record
- [Error-coercion helper flattens non-Error SDK objects](../code-quality/non-error-sdk-object-flattened-by-error-coercion-helper-2026-06-22.md) — why the raw SDK object is logged beside `err`
