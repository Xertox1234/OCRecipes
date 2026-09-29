---
title: "useChat's sendMessage can still send after an abort during the token read — the gap #1098 closed in useCoachStream"
status: done
priority: low
created: 2026-09-26
updated: 2026-09-29
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

- [x] `useSendMessage` gets the same epoch guard as `useCoachStream`, on both `.then`/await continuation and error paths, with tests: abort before the token resolves (no request), abort then send during the read (only the new request), and unmount during the read.
- [x] Either `abortStream(); sendMessage()` in one tick works (ownership-scoped `finally` teardown plus a synchronous ref reset), or it's documented as unsupported with a test pinning the refusal. Pick one.
- [x] `useCoachStream`'s `fail()` returns early when its epoch is stale, with a test.

## Implementation Notes

- The pattern and tests are in `client/hooks/useCoachStream.ts` and `client/hooks/__tests__/useCoachStream.test.ts` (the "overlapping starts" block).
- `docs/solutions/logic-errors/hook-level-mutation-needs-onmutate-epoch-context-2026-09-24.md` has a "Variant: an async pre-step before a streaming request" section.

## Scope Contract

- **Files in scope:** `client/hooks/useChat.ts`, `client/hooks/useCoachStream.ts`, and their tests.

## Dependencies

- None

## Updates

### 2026-09-29 (implemented)

- **AC2 — picked "make it work".** Mirroring `useCoachStream.abortStream` into `useSendMessage.abortStream` (full synchronous reset of `isStreamingRef`/`isStreaming` and every shared streaming-UI field, not just `xhr.abort()`) is _forced_ by AC1's own "abort then send during the read" test — that scenario cannot pass without `abortStream` synchronously releasing the overlap guard, so a same-tick `sendMessage()` restart isn't refused. Once that synchronous reset exists, the `finally` block's teardown must become ownership-scoped (gated on `epoch === sendEpochRef.current`), or a stale call's `finally` — which can run _after_ a newer call has already started, since it settles asynchronously once the aborted XHR's promise resolves — unconditionally tears down whichever request is current now. The `abortStream` expansion is therefore load-bearing for AC1, not scope creep beyond "local to the token-read path", even though it also touches the in-flight (post-token-read) abort path.
- **`useSendMessage` gained a new unmount effect** (epoch bump only, no `setState`) since the hook had no internal unmount hook before this — the async token read has nothing else to gate it on true unmount, only on `abortStream()` calls a caller happens to make. It first also aborted the in-flight XHR; the security review noted that changed ChatScreen (the only consumer that never aborted on leave) from "the reply finishes and is saved" to "the reply is cut off". **User ruling 2026-09-29: keep answering** — the unmount effect no longer aborts a reply already sent; the done handler still refreshes the conversation. Pinned by "keeps an already-sent reply running when unmounted, and refreshes the conversation when it finishes" (RED before the change). Screens that stop the reply on leave (RecipeChatScreen, CoachOverlayContent) still call `abortStream` themselves.
- **Tests:** `client/hooks/__tests__/useChat.test.ts` — new "token-read epoch guard" describe block: abort before the token resolves, abort-then-restart during the read, a stale token-read rejection while a new send runs, unmount before the token resolves, and (added during review) restarting cleanly after aborting an already-in-flight XHR in the same tick. `client/hooks/__tests__/useCoachStream.test.ts` — new "fail() epoch guard" test: a very late native error event on an already-aborted stream no longer calls `onError`.
- **Review (1 round, `code-reviewer` + `mobile-reviewer`):** mobile-reviewer: no findings. code-reviewer: one WARNING — the new tests only covered abort-before-XHR-exists, not abort-an-already-in-flight-XHR-then-restart-same-tick (the case the `finally` ownership-scoping specifically exists for). Fixed inline (one additive test, no production-code change) per the "small, in-scope, same files" bar — no second review round per the one-review-pass ruling (Step 10's mandatory confirmation pass, required regardless since Step 8/9 move HEAD past the reviewed SHA, covers the addition).
