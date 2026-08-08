---
title: Static error copy that collapses every failure into one cause tells the user a falsehood
track: bug
category: logic-errors
module: client
severity: medium
tags: [error-handling, auth, login, diagnosability, ux, network-errors, static-copy, anti-enumeration]
applies_to: [client/screens/LoginScreen-utils.ts, client/screens/**/*-utils.ts]
symptoms: [Login shows "Incorrect username or password" while the same credentials return 200 when POSTed directly, The server logs zero requests from the device during the failed sign-in, A user retypes a correct password repeatedly because the UI names the wrong cause, An unreachable backend, a DNS failure and a genuine 401 are indistinguishable on screen]
created: '2026-08-08'
---

# Static error copy that collapses every failure into one cause tells the user a falsehood

## Problem

`getAuthErrorMessage()` maps **every** error except `RATE_LIMITED` to one string:

```ts
export function getAuthErrorMessage(error: unknown, mode: AuthMode): string {
  if (error instanceof ApiError && error.code === "RATE_LIMITED") {
    return "Too many attempts. Please wait a few minutes and try again.";
  }
  return mode === "login"
    ? "Incorrect username or password. Please try again."   // ← also shown for network failures
    : "Registration failed. Please try again.";
}
```

A network failure — unreachable host, wrong base URL, DNS failure, timeout —
therefore renders as **"Incorrect username or password."** The app asserts a
specific, wrong cause for a failure it never diagnosed.

## Symptoms

- Sign-in reports bad credentials while `curl -X POST /api/auth/login` with the
  *same* username and password returns **200 with a valid token**.
- The backend logs **zero** requests from the device during those attempts —
  proof the request never arrived, so no 401 was ever issued.
- The user retypes a correct password indefinitely; nothing on screen suggests
  connectivity.

## Root Cause

Two distinct requirements got conflated into one branch:

1. **Do not render raw server text** (`no-error-message-in-ui`, anti-enumeration)
   — a real and correct constraint.
2. **Do not distinguish failure classes** — never required, and not implied by (1).

Satisfying (1) by returning a single hardcoded string satisfies (2) as a side
effect. Anti-enumeration only demands that a *wrong username* and a *wrong
password* be indistinguishable. It says nothing about "the server answered 401"
versus "the request never left the device" — those are not enumeration signals
about an account, and the user can act on the difference.

## Solution

Branch on the error's *class* before falling back to the generic credential copy.
The transport failure has no account semantics, so naming it leaks nothing:

```ts
if (error instanceof ApiError && error.code === "RATE_LIMITED") { … }

// A request that never reached the server cannot be a credential problem.
if (isNetworkError(error)) {
  return "Can't reach the server. Check your connection and try again.";
}

return mode === "login"
  ? "Incorrect username or password. Please try again."
  : "Registration failed. Please try again.";
```

Keep the credential copy identical for 401-with-bad-username and
401-with-bad-password — that distinction is the one anti-enumeration protects.

## Prevention

- A catch-all `return <copy>` in an error mapper is a smell: ask which failure
  classes reach it and whether the copy is *true* for each.
- Static copy may be **vague** ("something went wrong") without being **false**
  ("your password is wrong"). Vagueness is a security posture; a false cause is a
  bug, and it costs real debugging time — here it masked a stale
  `EXPO_PUBLIC_DOMAIN` for an entire session, for a human tester as well as an
  agent.
- When an error path is reachable only under conditions CI cannot produce
  (offline, wrong host), assume it is unexercised and read it directly.

## Exceptions — this does NOT contradict the existing error rules

- [Generic error messages for 5xx](../conventions/generic-error-messages-5xx-2026-05-13.md)
  is **server-side** and about not leaking internals (`ECONNREFUSED`, SQL text)
  to clients. Still binding.
- `no-error-message-in-ui` bars rendering `error.message` in the UI. Still
  binding — the fix above adds a *static* string for a new branch, not a
  server-supplied one.

Both rules constrain *what text you may show*. Neither requires that unrelated
failure classes share a single message.

## Related Files

- `client/screens/LoginScreen-utils.ts` — `getAuthErrorMessage()`
- `client/lib/api-error.ts` — `ApiError`, the `code` the mapper branches on
- `client/lib/query-client.ts` — `getApiUrl()`; a wrong base URL is the exact
  failure this copy misreports

## See Also

- [Generic error messages for 5xx responses](../conventions/generic-error-messages-5xx-2026-05-13.md) — the server-side sibling rule this one must not be read as overriding
- [Custom ESLint rules for client-side error patterns](../best-practices/custom-eslint-rules-client-side-error-patterns-2026-06-03.md) — where `no-error-message-in-ui` is defined
