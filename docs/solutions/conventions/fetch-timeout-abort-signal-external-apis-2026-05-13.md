---
title: Fetch timeout with AbortSignal for every external API call
track: knowledge
category: conventions
module: server
tags: [api, fetch, timeout, abort-signal, external-api]
applies_to: [server/services/**/*.ts]
created: '2026-05-13'
last_updated: '2026-10-30'
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

## Pitfall: the deadline must cover the body read

`fetch()` resolves as soon as the response **headers** arrive. If you clear a manual `AbortController` timer in a `finally` that wraps only the `fetch` call, the body read (`res.text()`, or the project's `readBodyWithLimit`) runs with no deadline. A peer that sends headers and then trickles the body holds the request open for undici's per-chunk `bodyTimeout` (300s), and that limit resets with every chunk. Reliability audit 2026-10-30 R06 (`importRecipeFromUrl`).

```typescript
// Bad: timer cleared before the body is read
try { res = await safeFetch(url, controller.signal); } finally { clearTimeout(timeout); }
const html = await readBodyWithLimit(res); // unbounded

// Good: one outer try/finally spans fetch AND body read
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
try {
  const res = await safeFetch(url, controller.signal);
  html = await readBodyWithLimit(res);
} finally {
  clearTimeout(timeout);
}
```

`AbortSignal.timeout(ms)` avoids the problem because it is never cleared and the same signal governs the body stream. The bug only occurs with the manual controller-plus-timer pattern.

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

- [Constructed network clients need explicit transport bounds](./constructed-network-clients-need-explicit-transport-bounds-2026-10-30.md) — OpenAI SDK, S3Client, pg Pool

- [OpenAI SDK timeout and error handling](../design-patterns/openai-sdk-timeout-and-error-handling-2026-05-13.md)
- [SSE AbortController — cancel OpenAI stream on client disconnect](../design-patterns/sse-abort-controller-cancel-openai-stream-2026-05-13.md)
