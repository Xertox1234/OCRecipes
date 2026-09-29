---
title: "Recipe and remix chat lists still show stale data after an aborted stream"
status: done
priority: low
created: 2026-09-26
updated: 2026-09-29
assignee:
labels: [deferred, client-state]
github_issue:
---

# Recipe and remix chat lists still show stale data after an aborted stream

## Summary

#1096 made a still-mounted chat list refetch on refocus, with a follow-up refetch after a 2s settle margin. That works for the coach path, where the server's post-disconnect work is a couple of database writes. The recipe/remix path keeps generating the whole reply after a disconnect, so no fixed margin can cover it.

## Background

Deferred by the #1096 executor, and flagged by its advisor and researcher. `useSendMessage`'s abort branch (`client/hooks/useChat.ts`) invalidates the conversation queries with `refetchType: "none"`. For recipe/remix chat, the server (`server/routes/chat.ts`, where `isCoachPath` is false) deliberately finishes and saves the full reply after the client disconnects. That can take tens of seconds (recipe + image generation), so a focus refetch, even the 2s follow-up, usually reads data from before the save. `refetchOnWindowFocus` is off globally, so nothing refreshes it again until the next navigation.

## Acceptance Criteria

- [x] After aborting a recipe/remix chat stream, the conversation list and messages show the server's finished reply without the user having to leave and come back.
- [x] The mechanism is cancelled on unmount and on logout (no timer or poll outlives the screen or the session).
- [x] A test proves the list ends up showing the saved reply when the save completes well after the abort.

## Implementation Notes

- The todo behind #1096 listed three options. This one needs Option 2 (a delayed `invalidateQueries`, sized to generation time, with a per-turn timer) or Option 3 (poll until the turn's assistant message appears, with a cap). Option 3 is more robust, because generation time varies.
- Reuse #1096's shape where possible: `client/hooks/useRefreshOnFocus.ts` (`settleMs`) and `docs/solutions/logic-errors/focus-refetch-races-refetchtype-none-invalidation-2026-09-25.md`.

## Scope Contract

- **Files in scope:** `client/hooks/useChat.ts`, `client/screens/RecipeChatScreen.tsx`, `client/screens/ChatListScreen.tsx`, and their tests.
- No server changes.

## Dependencies

- None

## Updates

### 2026-09-29 (implemented)

- **Short-circuited research** onto `docs/solutions/logic-errors/focus-refetch-races-refetchtype-none-invalidation-2026-09-25.md` (the #1096 solution doc), which already named this exact residual.
- **Mechanism (Option 3, poll with a cap):** `client/hooks/useChat.ts` gained `useMarkPendingRecipeTurn()` (marks a conversation id + abort timestamp), a shared `pollRecipeTurn()` decision function, and opt-in `pollPendingRecipeTurns`/`pollPendingRecipeTurn` params on `useChatConversations`/`useChatMessages` that arm TanStack Query's own `refetchInterval` (5s, capped at `SSE_TIMEOUT_MS + 30_000` ≈ 150s). The pending mark lives in the query cache itself (not a bare module singleton) under `["__pendingRecipeTurns"]`, so the existing `queryClient.clear()` on every auth teardown path wipes it for free, and each poll's timer is owned by its query observer (cleared by React Query on unmount) — no custom cleanup code needed for either half of AC2.
- **RecipeChatScreen.tsx**: unmount cleanup now marks the conversation pending when a stream was actually in flight (`isStreaming`/`conversationId` mirrored to refs — not effect deps — matching `docs/rules/hooks.md`'s ref-mirroring rule), and its `useChatMessages` call opts into the poll so a reopened conversation still mid-generation self-updates.
- **ChatListScreen.tsx**: opts into the poll, gated to the recipe segment (`pollPendingRecipeTurns: isRecipeMode`) since the server filters conversations strictly by type.
- **Review (2 rounds, code-reviewer + mobile-reviewer):** round 1 found one CRITICAL — the abort-effect's `conversationId` dep reran the cleanup (calling `abortStream()`) on the null→real-id transition `handleSend` does immediately before `sendMessage()` for a brand-new chat, silently killing the user's first message. Fixed by mirroring `conversationId` into a ref too; independently reproduced by reverting the fix against a new regression test before restoring it. Three WARNINGs also fixed inline: unconditional coach-segment polling (gated on `isRecipeMode`), `pollPendingRecipeTurns` leaking into `useChatConversations`'s query key (fragmenting a cache entry `CoachProScreen` shared), and the pending-turns cache entry's default 5-minute `gcTime` never being rescheduled (pinned to `Infinity`). Round 2: code-reviewer clean; mobile-reviewer advisory (one non-blocking WARNING — a comment overstates that gating the list poll on `isRecipeMode` covers "remix" turns too, when a `type=remix` conversation can never appear in either segment's list fetch and so can never resolve there; bounded self-healing waste to the cap, not a correctness bug, and RecipeChatScreen's own per-conversation poll still resolves it on reopen — the executor deferred it per the 2-round cap; the orchestrator then fixed it comment-only in 4ab7656e, which now states the remix-mark polling cost explicitly).
- **Tests:** `client/hooks/__tests__/useChat.test.ts` (mark/poll/resolve/cap-expiry/unmount-cancellation for both the list and messages polls, plus the gcTime and query-key-sharing fixes), `client/screens/__tests__/RecipeChatScreen.test.tsx` (mark-pending on unmount-while-streaming vs. idle; the CRITICAL's regression test), `client/screens/__tests__/ChatListScreen.test.tsx` (segment-gated wiring). `client/components/recipe-finder/__tests__/both-chats.test.tsx` needed a one-line mock addition (out-of-contract, disclosed) since it renders `RecipeChatScreen` through a full `@/hooks/useChat` mock that now needs the new export.
