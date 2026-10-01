---
title: "useSendMessage / useCoachStream track only the latest XHR — an overlapping send can't be aborted"
status: done
priority: low
created: 2026-09-24
updated: 2026-09-24
assignee:
labels: [deferred, client-state, hooks]
github_issue:
---

# useSendMessage / useCoachStream track only the latest XHR — an overlapping send can't be aborted

## Summary

`useSendMessage` in `client/hooks/useChat.ts` keeps its in-flight request in a single `xhrRef`. Each `sendMessage` overwrites it, and the `finally` clears it to `null`. If two sends overlap on one hook instance, `abortStream()` only reaches the newest request. When the first request finishes, it also nulls the ref while the second is still running, so the second can no longer be aborted. `useCoachStream` (`client/hooks/useCoachStream.ts`) has the same single-ref shape.

## Background

Deferred from the #1065 mobile review; the user approved filing it on 2026-09-24. The real UI can't reach this today, because the send button is disabled while streaming. It's a hardening item: any future caller that sends programmatically (quick replies, retry, a deep link) could overlap.

## Acceptance Criteria

- [x] Either overlapping sends are impossible at the hook level (`sendMessage` refuses or queues while `isStreamingRef.current`), or `abortStream()` aborts every in-flight request, and a request's cleanup only clears the ref when it still owns it.
- [x] Test: two overlapping `sendMessage` calls, then `abortStream()`. Assert the chosen behavior for both requests.
- [x] `useCoachStream` gets the same treatment, or a recorded reason why not.

## Implementation Notes

- Cheapest fix: in the `finally`, only clear the ref if it still points at this request: `if (xhrRef.current === xhr) xhrRef.current = null`. Combine it with a guard on `isStreamingRef.current` at the start of `sendMessage`.
- Tests: `client/hooks/__tests__/useChat.test.ts`, and `useCoachStream`'s tests in `client/hooks/__tests__/useCoachStream.test.ts`.

## Updates

### 2026-09-25

- Implemented: both `sendMessage` (`client/hooks/useChat.ts`) and `startStream` (`client/hooks/useCoachStream.ts`) now refuse a second call while `isStreamingRef.current` is already true (AC option A — overlap made impossible at the hook level, not queued). `useChat.ts` additionally applies the finally-ownership check (`if (xhrRef.current === ownXhr) xhrRef.current = null`) as defense in depth. `useCoachStream.ts` gained a new `isStreamingRef`, mirrored at every existing `setIsStreaming(...)` call site (drain-finish, `abortStream`, the guard/start, `fail()`, and the token-fetch `.catch`).
- Tests added: `client/hooks/__tests__/useChat.test.ts` (1 new test — overlap refused, abortStream still reaches the original request) and `client/hooks/__tests__/useCoachStream.test.ts` (3 new tests — overlap refused via call-count assertions since the test's XHR mock is a shared singleton, abort still reaches the original XHR, and a new stream is allowed once the prior one finishes).
- Reviewed clean by `code-reviewer` + `mobile-reviewer` (parallel dispatch, branch review) — no CRITICAL, no blocking findings. `code-reviewer`'s one WARNING (a `todos/archive/...` path cited in code comments before this file was archived) self-resolves once this file lands in `todos/archive/` in the same PR.
- Deferred, NOT fixed here (out of this todo's stated scope — overlapping _sendMessage/startStream calls_, not abort timing): `useCoachStream.startStream`'s `tokenStorage.get().then(...)` continuation is not gated on `isStreamingRef.current`, so calling `abortStream()` while that promise is still pending resets state but does not stop the pending `.then()` from later creating and sending an XHR anyway (this predates this todo — `xhrRef.current` was always `null`, and thus `abortStream()`'s abort call already a no-op, during that same window). A `startStream()` call shortly after such an abort can then race with that orphaned continuation. See `docs/solutions/logic-errors/hook-level-mutation-needs-onmutate-epoch-context-2026-09-24.md` for the general epoch-guard shape a fix would take. Flagged by the Step 3.5 advisor call (made late, at Step 6, not before implementation — a process gap); reported in the executor's `DEFERRED_WARNINGS` for the user to decide whether it becomes its own todo.
