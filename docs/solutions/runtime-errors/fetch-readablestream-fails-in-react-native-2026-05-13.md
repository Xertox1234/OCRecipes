---
title: "fetch ReadableStream Fails in React Native — Use XHR for SSE"
track: bug
category: runtime-errors
tags: [react-native, sse, fetch, xmlhttprequest, streaming, ios, nsurlsession]
module: client
applies_to: ["client/hooks/**/*Stream*.ts", "client/lib/sse*.ts"]
symptoms:
  - "`response.body` is `null` for `text/event-stream` responses in React Native"
  - "`isStreaming` stays `true` but `streamingContent` stays empty"
  - "SSE works in a browser but silently fails in React Native"
created: 2026-05-01
severity: high
---

# fetch ReadableStream Fails in React Native — Use XHR for SSE

## Problem

SSE streaming via `fetch` + `res.body.getReader()` silently fails in React Native. `response.body` is `null` for `text/event-stream` responses — `isStreaming` stays `true` but `streamingContent` never accumulates anything. This affects all React Native contexts (screens, modals, providers), not just specific ones.

## Symptoms

- Streaming indicator shows but no chunks arrive
- Works in a web browser with identical client code
- No error thrown; the loop reading from `body.getReader()` just returns `null` on the first iteration

## Root Cause

React Native's `fetch` polyfill is backed by iOS `NSURLSession`. `NSURLSession` does not expose a `ReadableStream`-compatible body for streaming responses — `response.body` returns `null` regardless of the response content type. This is a platform limitation, not a view-hierarchy issue and not a server problem.

## Solution

Use `XMLHttpRequest` with `onprogress` for SSE parsing. XHR's `responseText` accumulates incrementally and `onprogress` fires on each new delivery batch. Use a `processedLength` variable to slice only new bytes:

```typescript
let processedLength = 0;

xhr.onprogress = () => {
  const chunk = xhr.responseText.slice(processedLength);
  processedLength = xhr.responseText.length;
  // parse SSE lines from `chunk` using an sseBuffer for split payloads
};
```

Prefer `onprogress` over `onreadystatechange + readyState >= 3` — `onprogress` fires exactly once per delivery batch and is semantically cleaner.

## Prevention

- For SSE streaming in React Native, always use XHR. `fetch + ReadableStream` is web-only.
- Wrap the XHR-SSE logic in a hook (`useEventStream` or similar) so callers don't reach for `fetch` by reflex.
- Keep a buffer for split payloads — a single delivery batch can include partial events.

## Related Files

- `client/hooks/` — SSE consumer hooks
- `docs/patterns/hooks.md` — "SSE Client-Side Consumption via XMLHttpRequest"

## See Also

- [Mocking constructable web APIs (XHR) in Vitest](../design-patterns/mocking-constructable-web-apis-xhr-vitest-2026-05-13.md)
- [SSE abort controller cancel openai stream](../design-patterns/sse-abort-controller-cancel-openai-stream-2026-05-13.md)
