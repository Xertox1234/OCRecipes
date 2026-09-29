---
title: "All Conversations: a free-tier user reaching it by deep link opens Coach Pro for every coach row"
status: backlog
priority: low
created: 2026-09-29
updated: 2026-09-29
assignee:
labels: [deferred, react-native, premium]
github_issue:
---

# All Conversations: coach-row target for free-tier users

## Summary

`AllConversationsScreen`'s coach rows always open `CoachPro`. The screen has no premium check of its own and is reachable by the `conversation-list` deep link (`client/navigation/linking.ts`), so a free-tier user who arrives that way opens Coach Pro, not the plain `Chat` screen that `ChatListScreen`'s rows use.

## Background

Found in #1184's mobile review (the coach-row navigation fix). Before #1184 the coach-row tap did nothing, so this path was unreachable. Free-tier Chat and premium Coach Pro conversations share `type: "coach"` (`shared/schema.ts`) with no other discriminator. `CoachProScreen` does handle `isCoachPro === false`: it passes `isCoachPro` to `CoachChat` and disables the context fetch. So this is a mismatch in which screen a row opens, not a crash. Its in-app entry point ("See all" in `CoachProScreen`) is only shown to Coach Pro users.

## Acceptance Criteria

- [ ] When `usePremiumFeature("coachPro")` is false, a coach row opens `Chat` (`{ conversationId }`), the same screen `ChatListScreen`'s rows open. Coach Pro users still open `CoachPro`. While premium status is loading, keep opening `CoachPro` (CoachProScreen already treats loading as "assume access"), so a Coach Pro user is never routed to `Chat`.
- [ ] Keep the `{ pop: true }` nested-navigate form from #1184 for whichever route is chosen.
- [ ] A test covers the free-tier branch.

## Implementation Notes

- `client/screens/AllConversationsScreen.tsx` coach-row `onPress`; `client/screens/ChatListScreen.tsx` row handler for the free-tier precedent; `client/hooks/usePremiumFeatures.ts`; `client/navigation/ChatStackNavigator.tsx` (`Chat` and `CoachPro` routes).

## Scope Contract

- **Files in scope:** `client/screens/AllConversationsScreen.tsx`, `client/screens/__tests__/AllConversationsScreen.test.tsx`.

## Dependencies

- #1184 merged first.

## Updates

### 2026-09-29

- Auto-filed (Low) from #1184's mobile review.
