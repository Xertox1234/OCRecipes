---
title: "CoachChat shows a blank thread when message-history load fails"
status: done
priority: medium
created: 2026-05-28
updated: 2026-05-28
assignee:
labels: [react-native, client-state, error-handling]
github_issue:
---

# CoachChat shows a blank thread when message-history load fails

## Summary

Opening an existing conversation when the message-history query fails renders an empty thread (as if the conversation had no messages), with no error or retry. The live streaming/send path is already handled — only history load is silent.

## Background

Surfaced during a silent-failure investigation (unsolicited user report). A user re-opening a conversation during a network blip sees their history apparently wiped.

## Acceptance Criteria

- [ ] A failed history load shows an error/retry, not an empty conversation.
- [ ] A genuinely empty (brand-new) conversation remains distinguishable from a failed history fetch.

## Implementation Notes

- `client/components/coach/CoachChat.tsx:181` `const { data: messages } = useChatMessages(conversationId)` — read `isError`/`error` (the stream path already uses a `streamingError` state, lines ~84/134-141, so follow that precedent for a history-error surface).
- Line 184 `(messages ?? []).map(...)` collapses failure to an empty list.
- Confirm whether `useChatMessages` exposes `error`; if it strips it, fix the hook too (see the related data-hooks todo).

## Dependencies

- May overlap with the "data hooks hide query error" todo if `useChatMessages` also omits `error`.

## Risks

- Low. Additive error handling on a path the user already expects to populate.

## Updates

### 2026-05-28

- Initial creation. Finding verified by reading CoachChat.tsx:181-195.

### 2026-05-28 (resolved)

- `useChatMessages` already returns the full `useQuery` result (it does NOT strip
  `error`), so no hook-stripping fix was needed — the dependency on the
  data-hooks-hide-query-error todo did not block this. Added an optional `meta`
  param to `useChatMessages` so CoachChat alone opts into `silentError: true`
  (the global QueryCache toast net), leaving the 3 other consumers (ChatScreen,
  RecipeChatScreen, CoachOverlayContent) on the global toast backstop.
- CoachChat now reads `isError`/`refetch` and renders an accessible error +
  Retry in the FlatList `ListEmptyComponent`, gated on
  `isError && messages.length === 0` so a brand-new empty conversation and a
  stale-while-revalidate refetch failure both still render correctly (AC #2).
- Added 4 render tests to CoachChat.branches.test.tsx covering the new branch.
