---
title: "A chat screen that stays mounted doesn't pick up a reply the server finished after the user left"
status: in-progress
priority: low
created: 2026-09-24
updated: 2026-09-24
assignee:
labels: [deferred, client-state, react-native]
github_issue:
---

# A chat screen that stays mounted doesn't pick up a reply the server finished after the user left

## Summary

When a user leaves mid-reply, #1060 (coach) and #1065 (recipe/remix) mark the conversation and the conversation list stale with `refetchType: "none"`. That only refetches when a query observer mounts. A screen that stays mounted keeps showing its old data until something else triggers a fetch. Examples: `client/screens/ChatListScreen.tsx` under a stack, or the Coach Pro thread bar. On the recipe path this matters more, because recipe plus image generation keeps running for tens of seconds after the user leaves.

## Background

Deferred from the #1065 review (advisor plus the confirmation-pass reviewer); the user approved filing it on 2026-09-24.

- `refetchType: "none"` was chosen deliberately, so the refetch wouldn't race the server's write that is still in progress.
- `invalidateQueries` forces a refetch on the next mount regardless of `staleTime`, so a screen that mounts later is fine.
- The gap is only an observer that stays mounted across the disconnect. `ChatListScreen` has pull-to-refresh but no focus-driven refetch, and the app sets `refetchOnWindowFocus: false`.

## Acceptance Criteria

- [ ] A still-mounted chat list or conversation view shows the finished reply without a manual pull-to-refresh, within a reasonable delay after the server saves it.
- [ ] The chosen mechanism doesn't refetch before the server's write lands, or it doesn't matter if it does (it refetches again later).
- [ ] Test covering the chosen mechanism

## Implementation Notes

Options, pick one:

- **Refetch on screen focus:** `useFocusEffect` → `refetch()` in `ChatListScreen` and the conversation screens. This is simple and covers "user navigates back", but not a list that is visible the whole time.
- **Delayed invalidate after an abort:** a second `invalidateQueries` with the default refetch type, fired after a delay sized to generation time (for example 30–60 s for recipe). Costs one timer per aborted turn, and must be cleared on logout.
- **Polling while a turn is unsettled:** heavier; only worth it if the other two fall short.

Files: `client/hooks/useChat.ts` (`useSendMessage` abort branch), `client/components/CoachOverlayContent.tsx`, `client/components/coach/CoachChat.tsx`, `client/screens/ChatListScreen.tsx`.
