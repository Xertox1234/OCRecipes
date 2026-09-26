---
title: "useChat's sendMessage can still send after an abort during the token read — the gap #1098 closed in useCoachStream"
status: backlog
priority: low
created: 2026-09-26
updated: 2026-09-26
assignee:
labels: [deferred, hooks]
github_issue:
---

# useChat's sendMessage can still send after an abort during the token read — the gap #1098 closed in useCoachStream

## Summary

#1098 added a `streamEpochRef` to `useCoachStream`, so an abort or unmount during the async `tokenStorage.get()` can't send an orphaned request later. `useChat`'s `useSendMessage` has the same shape and no guard. The two hooks now differ on the exact bug class one of them was just hardened against.

## Background

From #1098's independent review (non-blocking suggestions; no current caller triggers these):

1. **Token-read gap.** In `client/hooks/useChat.ts`, `sendMessage` does `await tokenStorage.get()` before creating its XHR. `abortStream()` during that wait is a no-op (`xhrRef.current` is still null), so the request is sent anyway.
2. **Same-tick abort + send is refused.** `abortStream()` doesn't reset `isStreamingRef` synchronously; the old request's `finally` does, one tick later. So `abortStream(); sendMessage(...)` in one tick is silently refused by the overlap guard. The old request's `finally` also tears down state for whichever request is current, so the fix needs ownership-scoped teardown, not just a synchronous ref reset.
3. **`useCoachStream`'s `fail()` closure isn't epoch-gated.** A very late event on an already-aborted XHR could call `fail()` against a newer stream. The window is narrow.

## Acceptance Criteria

- [ ] `useSendMessage` gets the same epoch guard as `useCoachStream`, on both `.then`/await continuation and error paths, with tests: abort before the token resolves (no request), abort then send during the read (only the new request), and unmount during the read.
- [ ] Either `abortStream(); sendMessage()` in one tick works (ownership-scoped `finally` teardown plus a synchronous ref reset), or it's documented as unsupported with a test pinning the refusal. Pick one.
- [ ] `useCoachStream`'s `fail()` returns early when its epoch is stale, with a test.

## Implementation Notes

- The pattern and tests are in `client/hooks/useCoachStream.ts` and `client/hooks/__tests__/useCoachStream.test.ts` (the "overlapping starts" block).
- `docs/solutions/logic-errors/hook-level-mutation-needs-onmutate-epoch-context-2026-09-24.md` has a "Variant: an async pre-step before a streaming request" section.

## Scope Contract

- **Files in scope:** `client/hooks/useChat.ts`, `client/hooks/useCoachStream.ts`, and their tests.

## Dependencies

- None
