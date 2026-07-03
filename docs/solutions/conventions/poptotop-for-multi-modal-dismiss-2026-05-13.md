---
title: Use `navigation.popToTop()` to dismiss stacked modals
track: knowledge
category: conventions
module: client
tags: [react-navigation, modals, navigation, react-native]
applies_to: [client/screens/**/*.tsx]
created: '2026-05-13'
---

# Use `navigation.popToTop()` to dismiss stacked modals

## Rule

When a flow spans multiple stacked modals (e.g., Camera → Review → Confirm), use `navigation.popToTop()` on the terminal action to dismiss the entire modal stack.

## Examples

```typescript
// client/screens/ReceiptReviewScreen.tsx
confirmMutation.mutate(confirmItems, {
  onSuccess: () => {
    haptics.notification(Haptics.NotificationFeedbackType.Success);
    // Pop both ReceiptReview and ReceiptCapture modals
    navigation.popToTop();
  },
});
```

## When this applies

After completing a multi-step modal flow (capture → review → confirm) where the user should return to the main app.

## Exceptions

Single-modal flows where `goBack()` returns to the right screen.

## Why

`goBack()` only pops one screen — in a Camera → Review stack, it returns to the camera instead of the main app. `popToTop()` dismisses the entire modal stack cleanly.

## Related Files

- `client/screens/ReceiptReviewScreen.tsx`
