---
title: "Leaving recipe chat while sendMessage awaits the token skips the stale-mark for that turn"
status: backlog
priority: low
created: 2026-09-24
updated: 2026-09-24
assignee:
labels: [deferred, client-state, reliability]
github_issue:
---

# Leaving recipe chat while sendMessage awaits the token skips the stale-mark for that turn

## Summary

`useSendMessage` → `sendMessage` (`client/hooks/useChat.ts`) awaits `tokenStorage.get()` before it constructs the XHR and stores it in `xhrRef`. If `RecipeChatScreen` unmounts during that await, its cleanup calls `abortStream()` while `xhrRef.current` is still `null`, so nothing is aborted. The request then starts anyway, and the turn never hits the `if (aborted)` stale-mark branch.

## Background

Deferred from the #1065 code review; the user approved filing it on 2026-09-24. No data is lost: the server finishes and saves the reply (the finish-and-save policy). The only effect is a cache gap. That turn's conversation and the chat list aren't marked stale, so within the 5-minute `staleTime` the history can show the view from before the reply was saved.

The window is short (one SecureStore read), but a user tapping send and then back immediately can hit it.

## Acceptance Criteria

- [ ] An abort requested before the XHR exists is honored. Either the request never starts, or the stale-mark still happens when the stream ends.
- [ ] Test: call `abortStream()` while `tokenStorage.get()` is pending, then resolve it. Assert the chosen behavior (no XHR sent, or both query keys invalidated with `refetchType: "none"`). The test fails on current `main`.

## Implementation Notes

- `client/hooks/useChat.ts`: one option is an `abortRequestedRef` that `abortStream()` sets. Check it right after `await tokenStorage.get()`, and if set, skip the send and stale-mark or return. Clear it at the start of each `sendMessage`.
- If the request is skipped, no user message is created server-side, which is the right outcome for a user who left before sending.
- `client/hooks/__tests__/useChat.test.ts` already covers abort + invalidate; extend it.
