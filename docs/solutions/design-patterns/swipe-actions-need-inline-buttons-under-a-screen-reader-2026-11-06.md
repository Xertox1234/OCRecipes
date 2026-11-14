---
title: Swipe-only row actions need visible inline buttons while a screen reader is on — not custom actions on the swipe wrapper
track: knowledge
category: design-patterns
tags: [accessibility, voiceover, talkback, swipe, gesture, accessibilityActions, SwipeableRow, react-native]
module: client
applies_to: ["client/components/SwipeableRow.tsx", "client/**/*.tsx"]
created: 2026-11-06
last_updated: 2026-11-06
---

## Rule

A row action reachable only by a swipe gesture is unreachable with VoiceOver or TalkBack on (a one-finger swipe moves focus instead). `SwipeableRow` renders its inline action buttons when `useAccessibility().screenReaderEnabled` is true, exactly as it already did for `reducedMotion`. Do not "fix" a swipe-only action by putting `accessibilityActions` on the swipe wrapper, and do not tell screen-reader users to swipe in an `accessibilityHint`.

## Why

- Custom `accessibilityActions` are only offered on the element that holds accessibility focus (RN accessibility.md). In a shared swipe wrapper that element is a caller-owned child row; the wrapper can only offer actions by becoming `accessible` itself, which collapses the row's own interactive children into one leaf on iOS — the swallowed-children defect (`docs/rules/accessibility.md`, "Never set `accessible={true}` on a … wrapper that contains an interactive child").
- The inline buttons are already built, tested and themed for Reduce Motion, so the screen-reader branch adds one condition and no new UI.
- RNGH `ReanimatedSwipeable` documents no accessibility behaviour of its own.

## Examples

```tsx
const { reducedMotion, screenReaderEnabled } = useAccessibility();
if (reducedMotion || screenReaderEnabled) {
  return (
    <View>
      {children}
      <ReducedMotionActions leftAction={leftAction} rightAction={rightAction} />
    </View>
  );
}
```

A hint like `"Swipe left to delete"` became `"Opens the chat. Long press to delete"` (ChatList) and `"Opens the recipe"` (CookbookDetail).

## Related Files

- `client/components/SwipeableRow.tsx`, `client/components/__tests__/SwipeableRow.test.tsx`
- `client/hooks/useAccessibility.ts`

## See Also

- `docs/solutions/design-patterns/use-accessibility-hook-pattern-2026-05-13.md`
- `docs/solutions/logic-errors/toast-action-button-unreachable-by-screen-reader-2026-07-13.md`
