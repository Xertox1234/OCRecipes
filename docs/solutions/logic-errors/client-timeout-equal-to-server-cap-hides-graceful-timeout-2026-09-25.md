---
title: A client timeout equal to the server's cap on the same route fires first — the server's graceful timeout never arrives
track: bug
category: logic-errors
tags: [client-state, hooks, api, timeout, sse]
module: client
applies_to: ["client/hooks/useChat.ts", "client/hooks/useCoachStream.ts", "shared/constants/sse.ts", "server/routes/chat.ts"]
symptoms: ["A long reply ends with the client's generic 'Request timed out' instead of the server's own Response timeout error", "A client xhr.timeout literal equals a server-side cap on the same endpoint", "A server/client constant was shared but only the hook that already named it was switched over"]
created: 2026-09-25
severity: medium
---

# A client timeout equal to the server's cap on the same route fires first — the server's graceful timeout never arrives

## Problem

PR #1094 moved the server's `SSE_TIMEOUT_MS` (120s) into `shared/constants/sse.ts` so `useCoachStream` could derive its ceilings from it. A second hook, `useChat`'s `useSendMessage` (legacy coach chat and recipe chat), POSTs to the **same** route, `/api/chat/conversations/:id/messages`, with `xhr.timeout = 120_000`, which is **equal** to the server cap. It was left out of the refactor.

## Root Cause

- **The two timers do not start together.** The client's timer starts at `xhr.send()`. The server's `setTimeout(…, SSE_TIMEOUT_MS)` starts only after auth, the rate limit, and the daily-limit DB write. An equal client timer therefore always fires first, and the server's graceful timeout message can never be delivered.
- **The refactor swept by name, not by mechanism.** It updated every file that referenced `SSE_TIMEOUT_MS`, but `useChat` never named the constant. It hand-copied the number.

## Solution

`useChat` now derives `CHAT_XHR_TIMEOUT_MS = SSE_TIMEOUT_MS + 30_000`. That is the same 150s ceiling as `useCoachStream`'s `XHR_TIMEOUT_MS`; `useChat` has no inactivity watchdog, so this XHR timeout is its only client-side limit. A test asserts that `xhr.timeout > SSE_TIMEOUT_MS`. It failed at `120000 > 120000` before the fix.

## Prevention

- **When you share a server-enforced ceiling, list every client of the route that enforces it, not every file that names the constant.** Grep for the endpoint path, then check the timeout each caller arms. Grep for the number too (`120_000`, `120000`, `2 * 60 * 1000`).
- **A client ceiling beneath a server cap must be strictly greater, with a margin** that covers the server's pre-timer work. "Equal" is the bug, not a safe default.
- **Pin the ordering in a test** that imports the shared constant, so a later change to the server value moves the client ceiling with it or fails the test.

## Related Files

- `shared/constants/sse.ts` — `SSE_TIMEOUT_MS`, and the ordering contract in its docblock
- `client/hooks/useChat.ts` — `CHAT_XHR_TIMEOUT_MS`
- `client/hooks/useCoachStream.ts` — `STREAM_INACTIVITY_MS`, `XHR_TIMEOUT_MS`
- `server/routes/chat.ts` — the route and its `SSE_TIMEOUT_MS` timer

## See Also

- [shared AbortSignal downgrade hides timeout trace](shared-abortsignal-downgrade-hides-timeout-trace-2026-09-25.md) — another way a timeout on the same chat route gets hidden
