---
title: Signup silently traps users when the client form doesn't mirror strict server validation
track: bug
category: logic-errors
module: client
severity: high
tags: [auth, signup, validation, forms, client-state, zod, error-handling, rate-limit]
symptoms: [Account creation / a form submit fails on device or prod but works from curl with a 'clean' payload, The screen shows a generic message ('Registration failed. Please try again.') with no actionable reason, 'Server logs show POST … 400 VALIDATION_ERROR at responseTime: 0 (failed at the Zod layer before any DB/bcrypt work)', 'Users naturally type an email into a field the server restricts (e.g. ''Username'' constrained to ^[a-zA-Z0-9_]+$)']
applies_to: [client/screens/**/*.tsx, client/screens/**/*-utils.ts]
created: '2026-06-18'
---

# Signup silently traps users when the client form doesn't mirror strict server validation

## Problem

The server validates registration with a strict Zod schema (`registerSchema`:
username `^[a-zA-Z0-9_]+$`, password ≥8 + letter+digit, `ageConfirmed: literal(true)`).
The signup screen did **no** client-side format validation and its submit handler
swallowed the server response in a bare `catch {}`, replacing it with a static
generic string. Result: a user who types something the server rejects — most
commonly **their email address into the "Username" field** — gets "Registration
failed. Please try again." with no way to learn the actual rule, and is hard-blocked
from creating an account. The happy path worked; only the invalid-input path was
broken, so it was invisible to a curl test with a valid payload (which returns 201).

## Symptoms

- Signup fails on device/prod but a valid curl payload returns `201`.
- Generic on-screen error; the real reason (`username: Username can only contain
  letters, numbers, and underscores`) never surfaces.
- Railway HTTP log: `POST /api/auth/register → 400`, `responseTime: 0` (Zod-layer
  rejection, not DB/network).
- Each failed attempt also counts against the IP-keyed `registerLimiter` (5/hour,
  no skip on failures), so repeated retries silently flip to a masked `429`.

## Root Cause

A **client/server validation-contract mismatch** compounded by error-swallowing:

1. The client form enforced only non-empty + password-match + age checkbox — none
   of the server's format/length/complexity rules. So an email-shaped username
   (contains `@`/`.`) sailed past the client and was rejected by the server.
2. `LoginScreen.handleSubmit`'s `catch {}` discarded the server's specific 400
   message (which is intentional, actionable copy), showing a generic fallback.

The diagnostic blind spot was total: no client telemetry on the register path
(`reportError` was only wired into `QueryCache.onError`, i.e. queries), and the
server doesn't log request bodies — so the only signal was the masked UI string.

## Solution

Add a client-side pre-flight validator that **mirrors the server schema** and
return actionable, static copy that names the common trap; keep error handling
code-based (never render `error.message`).

```ts
// client/screens/LoginScreen-utils.ts — pure, unit-tested
const USERNAME_PATTERN = /^[a-zA-Z0-9_]+$/; // mirrors registerSchema.username
const PASSWORD_COMPLEXITY = /(?=.*[a-zA-Z])(?=.*\d)/; // mirrors registerSchema.password

export function validateAuthForm(input): string | null {
  const username = input.username.trim();
  if (!username || !input.password.trim()) return "Please fill in all fields";
  if (input.mode === "login") return null; // login stays LENIENT (no enum oracle)
  if (username.length < 3 || username.length > 30)
    return "Username must be between 3 and 30 characters";
  if (!USERNAME_PATTERN.test(username))
    return "Username can only contain letters, numbers, and underscores (it can't be an email address)";
  if (input.password.length < 8) return "Password must be at least 8 characters";
  if (!PASSWORD_COMPLEXITY.test(input.password))
    return "Password must contain at least one letter and one number";
  if (input.password !== input.confirmPassword) return "Passwords do not match";
  if (!input.ageConfirmed)
    return "You must confirm you are 13 years of age or older";
  return null;
}

// Error mapping: branch on ApiError.code, NEVER error.message (no-error-message-in-ui)
export function getAuthErrorMessage(error: unknown, mode): string {
  if (error instanceof ApiError && error.code === "RATE_LIMITED")
    return "Too many attempts. Please wait a few minutes and try again.";
  return mode === "login"
    ? "Incorrect username or password. Please try again."
    : "Registration failed. Please try again.";
}
```

Catching it client-side also means the doomed request never fires, so it can't burn
the register rate limit.

## Prevention

- For any form that POSTs to a strict server Zod schema, **mirror the key rules
  client-side** with actionable copy — don't rely on "server 400 + generic catch".
- **Keep client login LENIENT**: applying register's strict rules to login would
  lock out existing/short/email-shaped accounts (e.g. `demo`/`demo123`) and risks a
  username-enumeration oracle. Login's authority is the server; show a generic
  "incorrect username or password".
- Mark the client mirror **KEEP IN SYNC (manual)** with the server schema; the
  server still re-validates with zero trust (client check is UX, not a boundary).
- Extract the validator + error mapper as pure functions in a `*-utils.ts` sibling
  and unit-test them (mirrors the `client/components/*-utils.ts` convention).

## Related Files

- `client/screens/LoginScreen-utils.ts` — `validateAuthForm` + `getAuthErrorMessage`
- `client/screens/LoginScreen.tsx` — `handleSubmit` wiring
- `server/routes/_schemas.ts` — `registerSchema` (the mirrored source of truth)
- `server/routes/auth.ts` — `register` route (server re-validation)

## See Also

- [Input validation with Zod (parse before access)](../conventions/input-validation-with-zod-2026-05-13.md) — the server-side counterpart this mirrors
- [ApiError code-driven static copy](../conventions/apierror-code-driven-static-copy-2026-05-31.md) — the no-error-message-in-ui rule the error mapper complies with
