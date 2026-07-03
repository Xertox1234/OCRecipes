---
title: 'Error-coercion logging helper flattens non-Error SDK objects to [object Object]'
track: bug
category: code-quality
module: server
severity: medium
tags: [logging, error-handling, observability, resend, sdk, toError]
symptoms: ['Logs show err/message: "[object Object]" instead of a real error string', A third-party SDK call "fails" in the logs but gives no actionable reason, The failing log entry's stack runs through `toError` / `new Error(String(value))`]
applies_to: [server/services/**/*.ts, server/lib/logger.ts]
created: '2026-06-22'
---

# Error-coercion logging helper flattens non-Error SDK objects to [object Object]

## Problem

A shared "normalize-to-Error" logging helper turns anything that is not already
a JS `Error` into `new Error(String(value))`. When the value is a plain
**object** — e.g. an SDK's structured error response — `String(obj)` is the
literal `"[object Object]"`, so the real `message`/`name`/`statusCode` are
**silently destroyed** before they reach the log. The failure is logged, but the
log says nothing useful.

This bit the production email-verification gate-on: every Resend send failed and
the only signal in the Railway logs was `err: { message: "[object Object]" }`.
The actual reason (a sender-domain mismatch → Resend `validation_error` / 403)
was invisible, turning a one-line config fix into a debugging session.

## Symptoms

- A log line whose `err`/`message` field is the literal string `"[object Object]"`.
- An integration that demonstrably fails (no email sent, no API record) while the
  logs offer no reason.
- The stack frame just above the log call is the error-coercion helper
  (`toError`, `asError`, `ensureError`, etc.).

## Root Cause

`server/lib/logger.ts`:

```ts
export function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
```

The Resend SDK (like many SDKs — Stripe, AWS, Supabase) returns errors as a
**plain object** `{ message, name, statusCode }`, **not** a thrown `Error`. So
`value instanceof Error` is false and `String({...})` collapses to
`"[object Object]"`. The helper is fine for caught `Error`s; it is lossy for any
object that carries its diagnostics in enumerable fields.

## Solution

When the error value is a known structured SDK shape, **log its fields directly**
rather than coercing it to an `Error`:

```ts
// server/services/email.ts — before
if (error) logger.error({ err: toError(error) }, "verification email failed");

// after — pino serializes the object's enumerable fields
if (error) logger.error({ resendError: error }, "verification email failed");
// → { resendError: { name: "validation_error", message: "...domain is not verified", statusCode: 403 } }
```

Scope the change to the call sites that handle the non-Error shape. Do **not**
"fix" the shared `toError` to dig out `.message` for the email feature's
benefit — it is used by dozens of catch blocks, so widening it for one caller is
an unjustified blast radius (and `.message` alone still drops `statusCode`/`name`,
which the structured log keeps).

## Prevention

- Reach for `toError(...)` only when the value is plausibly a thrown `Error`.
  For an SDK call that **returns** `{ data, error }` (no throw), log the `error`
  object's fields directly — it never was an `Error`.
- A `String(value)` / template-interpolation of an unknown error value is the
  tell: it yields `"[object Object]"` for any object. Prefer structured logging
  (`{ someError: error }`) so the serializer keeps the fields.
- Confirm log legibility against a *real* failure (force the SDK to error in a
  test) — a green "it logs on failure" test that doesn't assert the fields would
  have missed this.

## Related Files

- `server/services/email.ts` — the two Resend send call sites (fix applied here)
- `server/lib/logger.ts` — `toError` (the lossy helper; intentionally left as-is)
- `server/services/__tests__/email.test.ts` — regression test asserting the
  structured `resendError` fields survive into the log

## See Also

- [SDKs with no AbortSignal need a Promise.race timeout + app-side 429-aware retry](../design-patterns/no-timeout-sdk-needs-promise-race-and-app-side-retry-2026-06-20.md) — same Resend send path; SDK-shape handling
