---
title: SSE AbortController — cancel OpenAI stream on client disconnect
track: knowledge
category: design-patterns
module: server
tags: [api, sse, abort-controller, openai, streaming, cost-control]
applies_to: [server/routes/**/*.ts, server/services/**/*.ts]
created: '2026-05-13'
---

# SSE AbortController — cancel OpenAI stream on client disconnect

## When this applies

When streaming an OpenAI response to a client over SSE, the server must propagate the client's disconnect signal all the way to the OpenAI SDK. Without this, the SDK keeps generating tokens (and billing) after the client leaves.

## Why

OpenAI charges by output tokens. A client that opens an SSE stream and immediately disconnects (closed tab, app backgrounded, navigation) leaves the server-side stream alive — the SDK keeps reading from the network and billing for the full response. Propagating the abort signal makes the cost map to the user-visible duration.

## Pattern

1. Create an `AbortController` at the route level, next to `let aborted = false`.
2. Call `abortController.abort()` everywhere `aborted = true` is set (req.close, SSE timeout).
3. Pass `abortSignal` through the service layer to the generator function.
4. Pass `{ signal: abortSignal }` as the second argument to `openai.chat.completions.create`.

## Examples

```typescript
// Route handler (server/routes/chat.ts)
const abortController = new AbortController();
let aborted = false;
req.on("close", () => {
  aborted = true;
  abortController.abort();              // ← kills the OpenAI stream
});
const sseTimeout = setTimeout(() => {
  aborted = true;
  abortController.abort();              // ← kills the OpenAI stream on timeout
  ...
}, SSE_TIMEOUT_MS);

for await (const event of handleCoachChat({
  ...
  isAborted: () => aborted,
  abortSignal: abortController.signal,  // ← passed through service layer
})) { ... }

// Service (coach-pro-chat.ts)
export interface CoachChatParams {
  abortSignal?: AbortSignal;            // optional — defaults to no signal
}

// Generator (nutrition-coach.ts)
export async function* generateCoachResponse(
  messages, context, abortSignal?: AbortSignal,
) {
  const stream = await openai.chat.completions.create(
    { model, stream: true, messages, ... },
    { timeout: OPENAI_TIMEOUT_STREAM_MS, signal: abortSignal },
  );
  ...
}
```

## Why isAborted() still exists alongside abortSignal

`isAborted()` gates the chunk-yield loop inside the generator (fast exit between chunks). `abortSignal` is passed to the SDK to cancel _in-flight_ network I/O before the next chunk arrives. Both are needed — they operate at different granularities.

## Related Files

- `server/routes/chat.ts`
- `server/services/coach-pro-chat.ts`
- `server/services/nutrition-coach.ts`

## Origin

Audit finding M8 (2026-04-18).

## See Also

- [OpenAI SDK timeout and tiered error handling](openai-sdk-timeout-and-error-handling-2026-05-13.md)
- [Fetch timeout with AbortSignal for every external API call](../conventions/fetch-timeout-abort-signal-external-apis-2026-05-13.md)
