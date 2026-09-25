---
title: "A shared AbortSignal fans in disconnect, timeout, and byte-limit — downgrading the consumer's log hides the timeout's own trace"
track: bug
category: logic-errors
module: server
tags: [api, architecture, sse, streaming, abort-controller, logging, testing]
applies_to: [server/routes/chat.ts, server/services/nutrition-coach.ts]
symptoms: ['A route holds one AbortController/AbortSignal shared by client-disconnect, an SSE timeout, and a byte-limit guard', 'A downstream generator downgrades its own abort-caused catch log from ERROR to debug keyed only on `abortSignal?.aborted`', 'The SSE-timeout handler itself logs nothing of its own', 'A genuine multi-minute hang produces no log line at ERROR or WARN anywhere']
created: '2026-09-25'
severity: medium
---

# A shared AbortSignal fans in disconnect, timeout, and byte-limit — downgrading the consumer's log hides the timeout's own trace

## Problem

When one `AbortController`/`AbortSignal` is shared across multiple distinct causes (client disconnect, an SSE timeout, a byte-limit guard), a downstream consumer that keys its own logging off `abortSignal?.aborted` cannot tell those causes apart. Downgrading that consumer's log from ERROR to debug — done here to stop a routine client disconnect from producing an error line on every Ask Coach dismiss — silently downgrades ALL of the signal's causes together, including a genuine multi-minute hang that has no log line of its own anywhere else.

## Symptoms

- A route holds one `AbortController`/`AbortSignal` shared by client-disconnect, an SSE timeout, and a byte-limit guard.
- A downstream generator downgrades its own abort-caused catch log from ERROR to debug, keyed only on `abortSignal?.aborted`.
- The SSE-timeout handler itself logs nothing of its own.
- A genuine multi-minute hang produces no log line at ERROR or WARN anywhere.

## Root Cause

`server/routes/chat.ts` creates one `AbortController` per request and aborts it from three places: `res.on("close")` (disconnect), the `sseTimeout` `setTimeout` callback, and the `SSE_MAX_RESPONSE_BYTES` guard. All three set the same `aborted = true` flag and call the same `abortController.abort()`. `server/services/nutrition-coach.ts`'s generators receive only the resulting `AbortSignal` — they have no way to ask which of the three callers aborted it. Gating a log-level downgrade purely on `abortSignal?.aborted` (correct for the disconnect case, per `todos/archive/P3-2026-09-24-coach-generators-log-error-on-client-abort.md`) also silently swallows the timeout case, which had no log line of its own before this fix. (The byte-limit guard never reaches these catch blocks: it trips inside the route's own `for await` while the generator is suspended at a `yield`, and `break` closes the generator via `return()`, which runs `finally`, not `catch`. It had no server-side log either.)

## Solution

Log each abort *cause* once, at its source, before delegating the shared signal downward:

```ts
// server/routes/chat.ts
const sseTimeout = setTimeout(() => {
  aborted = true;
  abortController.abort();
  logger.warn({ conversationId: id }, "chat SSE stream timed out");
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify({ error: "Response timeout" })}\n\n`);
    res.end();
  }
}, SSE_TIMEOUT_MS);
```

This keeps the downstream consumer's downgrade (correct for the common disconnect case) while restoring visibility for the rarer, more concerning cause — a hang. The byte-limit guard writes a distinct `{ error: "Response too large" }` payload to the client, but that is client-side only; both trip sites in `chat.ts` now also `logger.warn` with the byte count. Note that none of these logger calls reach Sentry (only `handleRouteError` and Express's error handler do, and neither runs once SSE headers are sent), so these warnings are visible in pino/log aggregation, not as Sentry alerts.

## Prevention

- Before downgrading a shared/reused signal's consumer-side log, enumerate every caller that sets the signal and check whether each one already has its own independent trace. If not, add one log call at the source rather than widen the consumer's exemption — the exemption can't distinguish causes the signal itself doesn't carry.
- **Testing note**: to assert on a module-load-time `createServiceLogger("...")` call from a test, mock `createServiceLogger` with a `vi.hoisted` singleton object (`const mockLog = vi.hoisted(() => ({ error: vi.fn(), debug: vi.fn(), ... }))`), not a per-call factory (`createServiceLogger: () => ({ error: vi.fn(), ... })`) — the module under test calls `createServiceLogger` exactly once at import time and captures that one return value, so a per-call factory returns a fresh object the test can never reach. No prior test in this codebase asserted on `.error`/`.debug` call arguments (`dev-api-cache.test.ts` and similar files mock the logger only to silence it); this is the first.

## Related Files

- `server/routes/chat.ts`: `abortController`, `sseTimeout`, the `res.on("close")` handler, the `SSE_MAX_RESPONSE_BYTES` guard
- `server/services/nutrition-coach.ts`: `generateCoachResponse`, `generateCoachProResponse`
- `server/services/__tests__/nutrition-coach.test.ts`: the `vi.hoisted` `mockLog` singleton

## See Also

- [SSE AbortController — cancel OpenAI stream on client disconnect](../design-patterns/sse-abort-controller-cancel-openai-stream-2026-05-13.md)
- [req.on('close') attached after express.json() never fires — detect a dropped client with res.on('close') + !res.writableFinished](req-close-never-fires-after-body-parser-use-res-close-2026-09-24.md)
