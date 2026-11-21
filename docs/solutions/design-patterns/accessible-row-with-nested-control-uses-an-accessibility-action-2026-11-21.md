---
title: "A row that is already one accessible element exposes its nested control as an accessibility action — and hides the touch-only control"
track: knowledge
category: design-patterns
tags: [accessibility, voiceover, talkback, accessibilityActions, adjustable, react-native]
module: client
applies_to: ["client/components/ChatBubble.tsx", "client/components/coach/blocks/write-cards/CardStepper.tsx", "client/**/*.tsx"]
created: '2026-11-21'
---

# A row that is already one accessible element exposes its nested control as an accessibility action — and hides the touch-only control

## When this applies

A row is deliberately ONE accessibility element (a chat reply read as one stop, a stepper that should be one adjustable control) and it also contains a small control (Read aloud, − / +). On iOS an `accessible` element swallows its children, so the nested control is unreachable under VoiceOver; on Android it is a separate, often unlabelled-in-context stop.

This is the opposite case from `swipe-actions-need-inline-buttons-under-a-screen-reader-2026-11-06.md`: there a shared wrapper would have to BECOME `accessible` and would swallow a caller's interactive rows. Here the row is already the right single element.

## Rule

- Put the behaviour on the row: `accessibilityActions` with a custom name and a label (`{ name: "speak", label: "Read aloud" }`) handled in `onAccessibilityAction`, or `accessibilityRole="adjustable"` + `accessibilityValue` + increment/decrement for a stepper.
- The row must actually be an element: `accessible` (without it iOS ignores the role, value and actions — CardStepper had all three and no `accessible`).
- Hide the visual control from assistive tech (`accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"`) so Android does not offer a duplicate stop. Touch keeps working.

## Why

RN docs: custom actions are offered on the focused element; `accessible` maps to an iOS accessibility element / Android focusable; an accessible element cannot also be a container for other elements (iOS). Accessibility audit 2026-11-21 M2 / M3.

## Examples

`client/components/chat-bubble-utils.ts` (`getSpeakAccessibilityActions`, `handleSpeakAccessibilityAction`, unit-tested because jsdom cannot fire accessibility actions); `CardStepper.tsx` (row `accessible` + `adjustable`, buttons and value hidden).

## Testing

jsdom cannot prove the iOS grouping (`docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md`). Pin the hidden controls (`queryByRole` returns null — find them by label for touch tests) and unit-test the action helpers; verify the grouping on a device.

## Related Files

- `client/components/ChatBubble.tsx`, `client/components/chat-bubble-utils.ts`, `client/components/coach/blocks/write-cards/CardStepper.tsx`

## See Also

- `docs/solutions/design-patterns/swipe-actions-need-inline-buttons-under-a-screen-reader-2026-11-06.md`
