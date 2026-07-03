---
title: CORS origin exact-match silently fails when env var has trailing slash
track: bug
category: logic-errors
module: server
severity: medium
tags: [security, cors, env, zod, middleware]
symptoms: [Web frontend receives no Access-Control-Allow-Origin header despite WEB_ORIGIN being set, Browser preflight fails with 'No Access-Control-Allow-Origin header is present', CORS works in dev (localhost) but silently blocks the configured production domain, 'Zod env validation passes at startup, no errors logged, but CORS allowlist is ineffective']
applies_to: [server/index.ts, server/lib/env.ts, server/middleware/**/*.ts]
created: '2026-06-12'
---

# CORS origin exact-match silently fails when env var has trailing slash

## Problem

When a CORS allowlist entry is validated by Zod `.url()` and then compared
with `===` against the browser's `Origin` header, a trailing slash on the env
var (`https://ocrecipes.app/`) causes every browser request to silently fail
the exact-match check.

Zod's `.url()` considers `https://example.com/` a valid URL (it is), so
startup validation passes without error. But browsers send `Origin:
https://example.com` with **no trailing slash** (RFC 6454 §6.1). The `===`
comparison returns `false` on every request, and no CORS headers are reflected
— the web frontend is locked out with no indication why.

## Symptoms

- `Access-Control-Allow-Origin` header is absent on responses to requests from
  the configured origin.
- No errors in server logs — Zod validation at startup passes silently.
- CORS works for other origins (e.g. `EXPO_PUBLIC_DOMAIN`) because those env
  vars typically lack a trailing slash.
- The failure is environment-specific (staging/prod where the var was set with
  a trailing slash vs. dev where you test via localhost).

## Root Cause

1. Zod `.url()` uses the WHATWG URL parser, which accepts `https://host/` as a
   valid URL — the trailing slash is a valid path component.
2. RFC 6454 §6.1 defines the Origin header value as `scheme "://" host [":"
   port]` — **no path, no trailing slash**.
3. An exact-match `===` comparison between a slash-suffixed stored value and a
   slash-free header value always returns `false`.

## Solution

Add a `.refine()` guard immediately after `.url()` in the Zod schema for any
env var that is compared against an `Origin` header with `===`:

```typescript
// server/lib/env.ts
WEB_ORIGIN: z
  .string()
  .url()
  .startsWith("https://", {
    message: "WEB_ORIGIN must use HTTPS",
  })
  .refine((v) => !v.endsWith("/"), {
    message:
      "WEB_ORIGIN must not have a trailing slash — browsers send " +
      "'Origin: https://example.com' (no slash) and the exact-match " +
      "check would silently fail, locking the web frontend out of CORS",
  })
  .optional(),
```

This causes the server to refuse to start with a clear error message when
the env var has a trailing slash, catching the misconfiguration before any
request reaches the CORS middleware.

## Prevention

- Any env var compared against an HTTP header with `===` or strict equality
  should use `.refine((v) => !v.endsWith("/"))` in its Zod schema if Zod's
  own validators (`.url()`, `.string()`) would accept the trailing-slash form.
- Document "set the bare origin, no trailing slash, e.g. `https://ocrecipes.app`"
  in the env var's inline comment.
- Applies to any future `*_ORIGIN` or `*_DOMAIN` env var that feeds a
  `=== origin` check in CORS middleware.

## Related Files

- `server/index.ts` — `setupCors` / `isAllowedOrigin`, lines 63–77
- `server/lib/env.ts` — Zod schema with `WEB_ORIGIN` refine guard

## See Also

- [CORS with pattern matching, never wildcard with credentials](../conventions/cors-pattern-matching-not-wildcard-2026-05-13.md)
- [Centralized environment validation with Zod schema](../design-patterns/centralized-env-validation-zod-2026-05-13.md)
