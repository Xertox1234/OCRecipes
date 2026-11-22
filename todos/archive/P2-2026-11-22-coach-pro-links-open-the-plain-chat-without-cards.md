---
title: "Coach Pro links open the plain chat, which draws no cards"
status: done
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
- [x] `ocrecipes://chat/<id>` for a Coach Pro user shows the conversation's cards (or opens it
      in `CoachPro`); a free user still gets `Chat`.
- [x] While the plan is still loading, the route follows the `AllConversationsScreen` rule
      (assume `CoachPro`).
- [x] Tests cover the plan-based route choice.

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

### 2026-11-22 — done

- `client/navigation/coachConversationRoute.ts` holds the route choice; `openCoachConversation`
  takes the plan (`useShowsCoachPro`, assume-Pro while loading). The toast reads it at tap time;
  `ChatScreen` hands a deep-linked conversation to CoachPro with `popTo` once the plan resolves
  to Pro, keyed on the id it was opened with.
- Simulator (iPhone 17 Pro, local server, demo = premium): `ocrecipes://chat/140255` cold and
  `ocrecipes://chat/139704` from the Home tab both opened CoachPro with the pantry card drawn.
- Criterion 1 needs a person: on a Coach Pro account, ask the coach from a recipe's overlay for
  a pantry change and tap "See the full reply in Coach" — the reply should open in the Coach tab
  with its card. Not run here: it needs a live (paid) AI reply. Unit-tested.
- Criterion 2 needs a person: let a coach reply finish while on another screen and tap the
  toast's Open — same expectation. Same reason; unit-tested, including the tap-time plan read.
- `openCoachWithMessage` (Weekly Report) still opens Chat for a Pro user: CoachPro takes no
  starting message. Filed as a follow-up todo.
