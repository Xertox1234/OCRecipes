---
title: URL Injection via Unencoded Path Segments
track: bug
category: runtime-errors
module: server
severity: high
tags: [security, url-injection, encodeuricomponent, ssrf, receipt-validation]
symptoms: [Outbound HTTP request sent to an unintended URL, 'User-supplied value containing /, ?, or # changes the path or adds query parameters', Server fetches a different resource than the code appears to request]
applies_to: [server/services/**/*.ts, server/routes/**/*.ts]
created: '2026-05-13'
---

# URL Injection via Unencoded Path Segments

## Problem

The initial Google Play receipt validation built a URL by interpolating
`purchaseToken` directly into a path segment without encoding:

```typescript
// Bug: purchaseToken could contain /, ?, # or other URL-significant characters
const url = `https://androidpublisher.googleapis.com/.../tokens/${purchaseToken}`;
```

If `purchaseToken` contained path traversal characters (e.g., `../` or
`?injected=param`), the request would be sent to an unintended URL. This is a
URL injection / SSRF-adjacent vulnerability — the attacker controls part of the
final URL the server fetches.

## Symptoms

- Outbound HTTP request sent to an unintended URL when the user-supplied value
  contains URL-significant characters (`/`, `?`, `#`).
- Server appears to call one endpoint but actually calls another.
- Logs show 404s on an attacker-controlled path under the same host.

## Root Cause

JavaScript template literals make string interpolation feel safe, but the URL
grammar treats `/`, `?`, `#`, and `%` as structural delimiters. Anything
embedded into a path segment that contains those characters mutates the URL
structure rather than appearing as data inside the segment.

## Solution

Apply `encodeURIComponent()` to every user-supplied or external value
interpolated into a URL path or query parameter:

```typescript
const url = `https://androidpublisher.googleapis.com/.../tokens/${encodeURIComponent(purchaseToken)}`;
```

For query strings, prefer `URLSearchParams` since it encodes every value:

```typescript
const params = new URLSearchParams({ token, source });
const url = `https://api.example.com/lookup?${params.toString()}`;
```

## Prevention

- Treat every interpolation `${...}` inside a URL string as suspect during code
  review. If the value comes from a request body, params, headers, or any
  external source, it must be encoded.
- When introducing a new outbound URL, scan the codebase for existing patterns
  (`encodeURIComponent`, `URLSearchParams`) and reuse them.
- Lint suggestion: add a custom ESLint rule or a grep gate for raw `${` inside
  URL template literals that doesn't pass through `encodeURIComponent`.

## Related Files

- `server/services/receipt-validation.ts` — fixed call site; encodes
  `packageName` and `purchaseToken` in the Google API URL.
- `server/services/nutrition-lookup.ts` — already encodes query params for USDA
  and API Ninjas calls.

## See Also

- [input-validation-with-zod](../conventions/input-validation-with-zod-2026-05-13.md) — validate
  incoming payloads at the boundary before they reach URL builders.
- [fetch-timeout-abort-signal-external-apis](../conventions/fetch-timeout-abort-signal-external-apis-2026-05-13.md) —
  pair URL hardening with timeouts on every outbound fetch.
