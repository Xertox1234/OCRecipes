---
title: "Fetch timeout with AbortSignal for every external API call"
track: knowledge
category: conventions
tags: [api, fetch, timeout, abort-signal, external-api]
module: server
applies_to: ["server/services/**/*.ts"]
created: 2026-05-13
---

# Fetch timeout with AbortSignal for every external API call

## Rule

Every outbound `fetch()` to an external API must include `AbortSignal.timeout()` to prevent hung connections from blocking server resources indefinitely. Node.js `fetch` has no default timeout — a slow or unresponsive upstream will hold the connection open until the OS-level TCP timeout (often 2+ minutes).

## Why

The receipt-validation code review found that both Google OAuth token exchange and subscription verification calls had no timeouts. In production, a hung Google API call would block the subscription upgrade endpoint indefinitely. `AbortSignal.timeout()` is the modern Node.js approach (available since Node 18) and is cleaner than manual `AbortController` + `setTimeout` patterns.

## Examples

```typescript
/** Timeout for outbound API requests (10 seconds). */
const FETCH_TIMEOUT_MS = 10_000;

// Good: Explicit timeout prevents hung connections
const response = await fetch("https://api.example.com/data", {
  headers: { Authorization: `Bearer ${token}` },
  signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
});

// Bad: No timeout — connection hangs if upstream is slow
const response = await fetch("https://api.example.com/data", {
  headers: { Authorization: `Bearer ${token}` },
});
```

Define the timeout as a named constant at module level.

## Recommended timeouts

- Payment / auth APIs (Google OAuth, Apple receipt): `10_000` (10s)
- Data APIs (USDA, nutrition lookup): `10_000` (10s)
- Large content fetches (recipe import, URL scraping): `15_000`–`30_000` (15-30s)

## Exceptions

Internal service calls where you control both endpoints and have other timeout mechanisms (e.g., Express request timeout middleware).

## Related Files

- `server/services/receipt-validation.ts` — Google OAuth and subscription API calls
- `server/services/recipe-import.ts` — `safeFetch` already uses `AbortSignal.timeout()`

## See Also

- [OpenAI SDK timeout and error handling](../design-patterns/openai-sdk-timeout-and-error-handling-2026-05-13.md)
- [SSE AbortController — cancel OpenAI stream on client disconnect](../design-patterns/sse-abort-controller-cancel-openai-stream-2026-05-13.md)
