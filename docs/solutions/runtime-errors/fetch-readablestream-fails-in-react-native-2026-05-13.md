---
title: fetch ReadableStream Fails in React Native — Use XHR for SSE
track: bug
category: runtime-errors
module: client
severity: high
tags: [react-native, sse, fetch, xmlhttprequest, streaming, ios, nsurlsession]
symptoms: ['`response.body` is `null` for `text/event-stream` responses in React Native', '`isStreaming` stays `true` but `streamingContent` stays empty', SSE works in a browser but silently fails in React Native]
applies_to: [client/hooks/**/*Stream*.ts, client/lib/sse*.ts]
created: '2026-05-01'
last_updated: '2026-10-26'
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
// A delivery batch can end mid-line. Keep the partial tail for the next batch;
// splitting each batch on its own drops every event a batch boundary cuts.
let lineBuffer = "";

xhr.onprogress = () => {
  const chunk = xhr.responseText.slice(processedLength);
  processedLength = xhr.responseText.length;
  lineBuffer += chunk;
  const lines = lineBuffer.split("\n");
  lineBuffer = lines.pop() ?? "";
  for (const line of lines) {
    if (!line.startsWith("data: ")) continue;
    // JSON.parse(line.slice(6)) …
  }
};
```

**The buffer is not optional (second manifestation, 2026-10-25).** This snippet used to show the buffer only as a comment. `useCoachStream` followed the snippet and split each batch on `\n` on its own: a `data:` line cut across two batches failed `JSON.parse` (swallowed by an "ignore incomplete JSON" `catch`), and its tail did not start with `data: `, so the event — Coach reply text — was silently dropped. `useChat` had the buffer all along. Pin it with a test that cuts one event mid-JSON across two chunks (`client/hooks/__tests__/useCoachStream.test.ts` → "keeps an event whose line is split across two network chunks"). The server ends every event with `\n\n`, so holding back the tail never loses a terminal event.

Prefer `onprogress` over `onreadystatechange + readyState >= 3` — `onprogress` fires exactly once per delivery batch and is semantically cleaner.

## Prevention

- For SSE streaming in React Native, always use XHR. `fetch + ReadableStream` is web-only.
- Wrap the XHR-SSE logic in a hook (`useEventStream` or similar) so callers don't reach for `fetch` by reflex.
- Keep a buffer for split payloads — a single delivery batch can include partial events.

## Related Files

- `client/hooks/` — SSE consumer hooks
- `docs/legacy-patterns/hooks.md` — "SSE Client-Side Consumption via XMLHttpRequest"

## See Also

- [Mocking constructable web APIs (XHR) in Vitest](../design-patterns/mocking-constructable-web-apis-xhr-vitest-2026-05-13.md)
- [SSE abort controller cancel openai stream](../design-patterns/sse-abort-controller-cancel-openai-stream-2026-05-13.md)
