---
title: "Weekly Report's ask-the-coach opens the plain chat for a Coach Pro user"
status: backlog
priority: low
created: 2026-11-22
updated: 2026-11-22
assignee:
labels: [deferred, react-native, coach]
github_issue:
---

# Weekly Report's ask-the-coach opens the plain chat for a Coach Pro user

## Summary

`openCoachWithMessage` (Weekly Report) still opens a new chat on the plain `Chat` screen for
everyone. For a Coach Pro user that chat draws no write cards, so a card in the reply cannot be
saved there.

## Background

Deferred from the Coach Pro links fix (branch `fix/coach-pro-links-open-coach-pro`, 2026-11-22),
which routes existing conversations to `CoachPro` by plan. A new chat that starts with a message
was left on `Chat` because `CoachPro` has no "start with this message" param: its draft opens
with the opening brief, and `ChatScreen` owns the `initialMessage` auto-send (with its
malformed-id guard). `ChatScreen`'s hand-off to `CoachPro` deliberately skips chats opened with
no id, so the first send does not pull the user out mid-reply.

## Acceptance Criteria

- [ ] A Coach Pro user who asks the coach from the Weekly Report gets the reply's write cards.
- [ ] A free user's Weekly Report question still opens `Chat` and auto-sends as today.
- [ ] Tests cover both plans.

## Implementation Notes

- `client/navigation/openCoachConversation.ts` (`openCoachWithMessage`),
  `client/screens/WeeklyReportScreen.tsx`, `client/screens/CoachProScreen.tsx` (a one-shot
  starting-message param, read-and-clear like `selectedConversationId`),
  `client/navigation/ChatStackNavigator.tsx` (`CoachPro` params type).
- Route choice helpers: `client/navigation/coachConversationRoute.ts`.

## Dependencies

- None.

## Risks

- The opening brief and a starting message on the same draft: decide which shows.

## Updates

### 2026-11-22

- Initial creation (deferred from the Coach Pro links fix).
