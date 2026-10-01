---
title: "A chat screen that stays mounted doesn't pick up a reply the server finished after the user left"
status: done
priority: low
created: 2026-09-24
updated: 2026-09-25
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

- [x] A still-mounted chat list or conversation view shows the finished reply without a manual pull-to-refresh, within a reasonable delay after the server saves it.
- [x] The chosen mechanism doesn't refetch before the server's write lands, or it doesn't matter if it does (it refetches again later).
- [x] Test covering the chosen mechanism

## Implementation Notes

Options, pick one:

- **Refetch on screen focus:** `useFocusEffect` → `refetch()` in `ChatListScreen` and the conversation screens. This is simple and covers "user navigates back", but not a list that is visible the whole time.
- **Delayed invalidate after an abort:** a second `invalidateQueries` with the default refetch type, fired after a delay sized to generation time (for example 30–60 s for recipe). Costs one timer per aborted turn, and must be cleared on logout.
- **Polling while a turn is unsettled:** heavier; only worth it if the other two fall short.

Files: `client/hooks/useChat.ts` (`useSendMessage` abort branch), `client/components/CoachOverlayContent.tsx`, `client/components/coach/CoachChat.tsx`, `client/screens/ChatListScreen.tsx`.

## Updates

### 2026-09-25 (implemented)

- **Chosen mechanism: Option 1 (refetch on screen focus).** Wired the existing, previously-unused `client/hooks/useRefreshOnFocus.ts` hook (skip-first-focus, then `refetch()` on every later focus) into the three places that actually stay mounted:
  - `client/screens/ChatListScreen.tsx` — `useChatConversations(activeSegment)`'s `refetch`.
  - `client/components/coach/CoachChat.tsx` — `useChatMessages(conversationId, ...)`'s `refetch`, guarded on `conversationId !== null` (a manual `refetch()` bypasses TanStack Query's `enabled` gate — verified against the pinned `@tanstack/query-core` source, `Query.fetch()` has no `enabled` check).
  - `client/screens/CoachProScreen.tsx` — `useChatConversations("coach")`'s `refetch`, backing the "Coach Pro thread bar" the Summary names as its second example (this file wasn't in the original Implementation Notes file list; added because the thread bar's own conversations query, not CoachChat's messages, is what actually renders that UI and stays mounted across a tab blur/refocus — see PR body "Out of contract").
  - `client/screens/ChatListScreen.tsx`'s `RefreshControl` was also switched from the query's own `isRefetching` to a new local `isManualRefreshing` flag, so the new background focus-refetch doesn't flash the pull-to-refresh spinner on every tab return.
- **`client/components/CoachOverlayContent.tsx`: no change.** Its only mount site (`CoachChatScreen.tsx`) is a native-stack `fullScreenModal`, which fully unmounts on dismiss — a remount already gets fresh data via the existing (non-`"none"`) `invalidateQueries` calls from #1060, so there is no stale-mounted-observer gap there.
- **`client/hooks/useChat.ts`'s `useSendMessage` abort branch (recipe/remix path): no change.** Option 1 alone leaves a known gap there — recipe/remix generation runs for tens of seconds, and a focus-refetch that fires before it finishes gets stale data with nothing to re-trigger a later refetch (since `refetchOnWindowFocus` is off). This is the todo's own acknowledged Option-1 limitation ("not a list that is visible the whole time"); Option 2 (delayed invalidate) would be needed to close it and is left as a follow-up decision for the user rather than folded into this P3 fix.
- **Tests:** `client/screens/__tests__/ChatListScreen.test.tsx` (new), `client/components/coach/__tests__/CoachChat.branches.test.tsx` (new describe block: refetch-on-refocus + the `conversationId: null` guard), `client/screens/__tests__/CoachProScreen.test.tsx` (new describe block for the thread bar). `CoachChat.test.tsx` and `CoachChat.render-item-stability.test.tsx` needed a `useFocusEffect` addition to their existing `@react-navigation/native` mocks (no-op) so the new `useRefreshOnFocus` call doesn't crash them.
- **Review:** `code-reviewer` + `mobile-reviewer`, one round. Both verified the `enabled`-bypass and referential-stability claims directly against the pinned `@tanstack/query-core`/`@react-navigation/core` source rather than trusting the code comments. code-reviewer's one WARNING (no test asserted the spinner-flash fix) was fixed inline (locally overriding `RefreshControl`/`FlatList` in the test file, following the project's documented `RefreshControl`-under-mock pattern). mobile-reviewer's SUGGESTION (an inaccurate "coordinated pull-to-refresh" precedent claim in a comment) was also fixed inline. No CRITICAL findings either round.

### 2026-09-25 (review repair)

- Independent review of `48c7b6f5`: `useRefreshOnFocus` gains an opt-in `settleMs` follow-up — ChatListScreen/CoachProScreen now refetch immediately AND once more after `REFRESH_ON_FOCUS_SETTLE_MS` (2s, sized from `server/routes/chat.ts`'s post-disconnect SELECT + one write), cleared on blur/unmount, because the refocus lands in the same transition as the `refetchType: "none"` abort invalidation and would otherwise latch pre-settle data for the 5-min staleTime; removed the CoachChat wiring (its messages key had no reachable stale trigger — CoachProScreen, the Coach tab's persistent root, never unmounts it) and corrected CoachProScreen's comment to name its real trigger (the Ask Coach overlay's dismissal). Correction to the entry above: the hook was NOT previously unused — `useLibraryCounts.ts`/`useProfileWidgets.ts` (Profile hub, #34) have called it all along; they keep the default one-refetch-per-refocus behaviour.
