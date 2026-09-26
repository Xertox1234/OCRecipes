---
title: "AllConversationsScreen stays mounted and never refetches — same staleness shape #1096 fixed for ChatListScreen"
status: backlog
priority: low
created: 2026-09-26
updated: 2026-09-26
assignee:
labels: [deferred, client-state]
github_issue:
---

# AllConversationsScreen stays mounted and never refetches — same staleness shape #1096 fixed for ChatListScreen

## Summary

`client/screens/AllConversationsScreen.tsx` reads `useChatConversations` and can stay mounted under a pushed chat screen. After an aborted stream invalidates the conversations with `refetchType: "none"`, it keeps showing the old list until it remounts. That's the same problem #1096 fixed for ChatListScreen and CoachProScreen.

## Background

Flagged by #1096's mobile reviewer as out of scope, because the original todo didn't name this screen.

The reviewer also raised a subtlety in `client/hooks/useRefreshOnFocus.ts`. Its skip-first-focus logic assumes the screen mounts already focused. A screen that mounts _blurred_ would treat its first real refocus as the mount, and skip it. The deep-link path `chat/:conversationId` was checked and doesn't hit this. The in-app path `navigation.navigate("CoachPro", { selectedConversationId })` from AllConversationsScreen was reasoned about but not verified.

## Acceptance Criteria

- [ ] AllConversationsScreen picks up changes to the conversation list after returning from an aborted stream (wire `useRefreshOnFocus` with `settleMs: REFRESH_ON_FOCUS_SETTLE_MS`, as ChatListScreen does).
- [ ] A test with a stateful `refetch` mock, returning pre-settle data then settled data (the ChatListScreen test shape), proves the list ends up showing settled data.
- [ ] Verify or rule out the mounted-while-blurred case for the `navigate("CoachPro", …)` path. If it's real, fix the skip-first heuristic (for example, skip only when the screen is focused at mount) and test it.

## Implementation Notes

- The pattern is in `client/screens/ChatListScreen.tsx` and `client/screens/__tests__/ChatListScreen.test.tsx` since #1096.
- `useRefreshOnFocus` has other callers (`client/hooks/useLibraryCounts.ts`, `client/hooks/useProfileWidgets.ts`). Any heuristic change must keep their behaviour.

## Scope Contract

- **Files in scope:** `client/screens/AllConversationsScreen.tsx`, its test, and `client/hooks/useRefreshOnFocus.ts` plus its test (only if the blurred-mount case is real).

## Dependencies

- None
