---
title: "Recipe and remix chat lists still show stale data after an aborted stream"
status: backlog
priority: low
created: 2026-09-26
updated: 2026-09-26
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

- [ ] After aborting a recipe/remix chat stream, the conversation list and messages show the server's finished reply without the user having to leave and come back.
- [ ] The mechanism is cancelled on unmount and on logout (no timer or poll outlives the screen or the session).
- [ ] A test proves the list ends up showing the saved reply when the save completes well after the abort.

## Implementation Notes

- The todo behind #1096 listed three options. This one needs Option 2 (a delayed `invalidateQueries`, sized to generation time, with a per-turn timer) or Option 3 (poll until the turn's assistant message appears, with a cap). Option 3 is more robust, because generation time varies.
- Reuse #1096's shape where possible: `client/hooks/useRefreshOnFocus.ts` (`settleMs`) and `docs/solutions/logic-errors/focus-refetch-races-refetchtype-none-invalidation-2026-09-25.md`.

## Scope Contract

- **Files in scope:** `client/hooks/useChat.ts`, `client/screens/RecipeChatScreen.tsx`, `client/screens/ChatListScreen.tsx`, and their tests.
- No server changes.

## Dependencies

- None
