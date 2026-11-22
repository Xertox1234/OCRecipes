---
title: "Coach Pro links open the plain chat, which draws no cards"
status: backlog
priority: medium
created: 2026-11-22
updated: 2026-11-22
assignee:
labels: [deferred, react-native, coach]
github_issue:
---

# Coach Pro links open the plain chat, which draws no cards

## Summary

For a Coach Pro user, `openCoachConversation` and the `ocrecipes://chat/<id>` deep link open
the plain `ChatScreen`, which draws no blocks. A reply's write card (pantry, grocery, food,
plan) is missing there, so the user cannot save it from the screen they were sent to.

## Background

Found during the pantry-card simulator check (2026-11-22). The seeded card chat opened through
`ocrecipes://chat/140255` showed only the reply text. The same chat opened from the Coach tab
(`CoachProScreen` → `CoachChat`) showed the card. Deferred: the fix is in navigation, outside
that todo's write-card scope.

Seen only through the deep link. The two in-app callers below use the same route and were read
in code, not reproduced:

- `client/navigation/MainTabNavigator.tsx` `CoachReplyToastBridge`: the "Coach replied — tap to
  open" toast's Open.
- `client/components/CoachOverlayContent.tsx`: the link it shows _because_ the reply has cards
  ("a reply's cards work in the Coach tab").

`AllConversationsScreen` already routes by plan (`showCoachPro` → `CoachPro` with
`selectedConversationId`, else `Chat`); `openCoachConversation` does not.

## Acceptance Criteria

- [ ] A Coach Pro user who taps the overlay's full-reply link lands on the conversation in
      `CoachPro`, with the card drawn.
- [ ] The same for the "Coach replied" toast's Open.
- [ ] `ocrecipes://chat/<id>` for a Coach Pro user shows the conversation's cards (or opens it
      in `CoachPro`); a free user still gets `Chat`.
- [ ] While the plan is still loading, the route follows the `AllConversationsScreen` rule
      (assume `CoachPro`).
- [ ] Tests cover the plan-based route choice.

## Implementation Notes

- `client/navigation/openCoachConversation.ts` (both helpers), its callers above, and the
  `Chat` entry in `client/navigation/linking.ts`.
- Route shape for `CoachPro`: see `AllConversationsScreen.tsx` around the `showCoachPro`
  branch (`selectedConversationId`; mind the nested `pop`).
- `openCoachConversation` runs outside React (`navigationRef`), so the plan has to be passed in
  or read from somewhere it can reach.
- Doc on the nested-route pitfalls:
  `docs/solutions/logic-errors/bare-navigate-cannot-descend-into-an-unrelated-nested-navigator-2026-09-29.md`.

## Dependencies

- None.

## Risks

- `openCoachWithMessage` shares the same route; check whether a new Pro chat started from a
  message should also go to `CoachPro`.

## Updates

### 2026-11-22

- Initial creation (deferred from the pantry-card simulator check).
