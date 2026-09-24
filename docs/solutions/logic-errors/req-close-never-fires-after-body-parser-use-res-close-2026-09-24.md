---
title: "req.on('close') attached after express.json() never fires — detect a dropped client with res.on('close') + !res.writableFinished"
track: bug
category: logic-errors
module: server
severity: high
tags: [api, testing, sse, streaming, abort-controller, express, node]
applies_to: [server/routes/**/*.ts]
symptoms: ['A route handler registers req.on("close") after an await (body already parsed) to detect client disconnect', 'An AbortController meant to stop OpenAI spend on disconnect never aborts in production', 'Every disconnect test uses supertest, which always reads the full response, so no test ever drops the connection', 'Code that is gated on an `aborted` flag (skip persistence, skip cache) reads as live but never runs']
created: '2026-09-24'
---

# req.on('close') attached after express.json() never fires — detect a dropped client with res.on('close') + !res.writableFinished

## Problem

`POST /api/chat/conversations/:id/messages` registered `req.on("close", ...)` so that a client disconnect would set `aborted = true` and abort the OpenAI stream (audit finding M8). On Node 24, the runtime this app uses in production, that listener **never ran**. It didn't run on a disconnect and it didn't run on a normal completion. Every disconnected turn kept generating to the end, billed the full output, and saved the full reply. A later audit (H6) then read the `if (!aborted)` branches as live and reported a bug that couldn't happen. The real bug was the opposite one.

## Symptoms

- A disconnect handler on `req` sits after `express.json()` and after the handler's own `await`s.
- The "stop spending tokens on disconnect" behavior doesn't show up anywhere: no aborted OpenAI requests, and replies are saved even when the client left.
- Tests all pass, but they only use supertest, which can't drop a connection mid-stream.

## Root Cause

`IncomingMessage` (`req`) emits `close` once the request is finished, and for a body-parsed request that is right after the body is consumed. `express.json()` reads the whole body before the handler runs, so `close` fired before the `req.on("close")` line executed. A listener attached late to an event that fires once never hears it. A plain Express repro (`express.json()`, an async handler that attaches listeners after a 20ms await, a client that destroys its socket mid-stream) printed:

```
--- client aborts mid-stream          --- normal completion
res close (writableFinished=false)    res close (writableFinished=true)
(req close: never)                    (req close: never)
```

The response is the stream that lasts as long as the connection. Its `close` fires on a dropped client and on a normal end, and `writableFinished` tells the two apart.

## Solution

```ts
let clientDisconnected = false;
res.on("close", () => {
  if (res.writableFinished) return; // our own res.end() completed — not a disconnect
  clientDisconnected = true;
  aborted = true;
  abortController.abort();
});
```

Run any post-disconnect bookkeeping (refund, save the partial) **before** `res.end()`, keyed on `clientDisconnected`. Don't key it on a shared `aborted` flag: in `chat.ts`, `aborted` is also set by the SSE timeout and the byte-limit guard.

Making the abort real can change behavior somewhere else. Once a disconnect actually aborts, any path whose persistence is gated on `!aborted` stops saving on disconnect. In `chat.ts` the recipe/remix path can't salvage half a recipe JSON, so the handler returns early for it and keeps the old finish-and-save behavior (`todos/P2-2026-09-24-recipe-chat-disconnect-policy.md`).

## Prevention

- **Test disconnects over a real socket.** supertest can't reproduce this. `postAndDisconnect` in `server/routes/__tests__/chat.test.ts` does: `app.listen(0)`, `http.request`, `clientReq.destroy()` once a body predicate matches, and a `res.end` wrapper as the "handler finished" signal, so negative assertions made after it are meaningful. Pass the abort to the fake generator through the real `AbortSignal` (`await untilAborted(signal)`). Don't use timers.
- Include a **completed-stream control** cell. It must pass both before and after the fix, which proves the harness doesn't report every stream as a disconnect.
- Measure the version claim on the runtime you ship. This one was measured on Node 24 (`engines: 24.x`).

## Related Files

- `server/routes/chat.ts`: the `res.on("close")` handler and the H6 settle block
- `server/routes/__tests__/chat.test.ts`: `describe("client disconnect mid-stream (H6)")`

## See Also

- [SSE AbortController — cancel OpenAI stream on client disconnect](../design-patterns/sse-abort-controller-cancel-openai-stream-2026-05-13.md). This pattern doc carried the dead `req.on` example; it is now corrected.
- [A partial cut from a post-hoc-vetted stream was never vetted](partial-of-post-hoc-vetted-stream-bypasses-safety-check-2026-09-24.md)
