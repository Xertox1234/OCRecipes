---
title: fullScreenModal dismissal requires navigation.goBack() after navigate()
track: bug
category: logic-errors
module: client
severity: medium
tags: [react-navigation, modal, navigation-stack, ux, back-button]
symptoms: ['After navigating from a fullScreenModal, pressing Back returns to the modal instead of its origin', Modal stays in the navigation stack after the user moves to the destination, Back button on the destination screen has unexpected target]
applies_to: [client/screens/**/*.tsx, client/navigation/**/*.tsx]
created: '2026-05-09'
---

# fullScreenModal dismissal requires navigation.goBack() after navigate()

## Problem

When a `fullScreenModal` screen programmatically navigates the user to another screen (e.g., from a "success" screen to a destination screen), calling `navigation.navigate()` alone leaves the modal on the navigation stack. The user sees the destination but pressing Back returns them to the modal instead of its origin.

## Symptoms

- Destination screen's Back button returns to the closing modal
- Modal remains on the navigator stack despite being visually dismissed
- Users get stuck in a back-loop between the modal and the destination

## Root Cause

React Native `Modal` components handle their own dismissal, but navigation-presented modals (`presentation: "modal"` or `presentation: "fullScreenModal"`) are real entries on the navigation stack. `navigation.navigate(...)` pushes a new screen on top of the modal rather than replacing it.

## Solution

Call `navigation.goBack()` immediately after `navigation.navigate()` to pop the modal off the stack:

```typescript
// Bad — modal stays on stack; Back goes to modal, not its origin
navigation.navigate("RecipeDetail", { recipeId });

// Good — navigate to destination, then dismiss the modal
navigation.navigate("RecipeDetail", { recipeId });
navigation.goBack();
```

This applies to any screen registered with `presentation: "fullScreenModal"` or `presentation: "modal"` in the stack navigator.

## Prevention

When introducing a new `fullScreenModal` screen that programmatically forwards the user elsewhere, include both calls in the same handler. Add a code comment explaining the dismissal contract so future authors don't strip the apparently-redundant `goBack()`.

## Related Files

- `client/screens/RecipeGenerationModal.tsx`
- Audit 2026-05-09 H6

## See Also

- [Dismiss then navigate modal to screen](../design-patterns/dismiss-then-navigate-modal-to-screen-2026-05-13.md)
- [Navigate vs replace modal flows](../conventions/navigate-vs-replace-modal-flows-2026-05-13.md)
