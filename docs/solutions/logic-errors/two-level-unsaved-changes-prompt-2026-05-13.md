---
title: "Two-Level Unsaved-Changes Prompt Fires Twice"
track: bug
category: logic-errors
tags: [react-navigation, beforeRemove, unsaved-changes, wizard, alert]
module: client
applies_to:
  [
    "client/components/recipe-wizard/WizardShell.tsx",
    "client/screens/meal-plan/RecipeCreateScreen.tsx",
  ]
symptoms:
  - "Discard-changes Alert appears twice when the user backs out of a wizard"
  - "User must tap 'Discard' twice to actually exit"
  - "Child component and parent screen each own a copy of the prompt"
created: 2026-04-17
severity: medium
---

# Two-Level Unsaved-Changes Prompt Fires Twice

## Problem

`WizardShell` (child component) had a discard-changes Alert in its `goBack` handler for step 1. `RecipeCreateScreen` (parent) also had a `beforeRemove` listener showing an identical Alert when `isDirtyRef.current === true`. Tapping the in-wizard Back button on step 1 fired both prompts in sequence: WizardShell's Alert, then on "Discard" the navigation triggered `beforeRemove`, which showed the second identical Alert. The user had to tap "Discard" twice to actually exit.

## Symptoms

- Two identical "Discard changes?" dialogs in a row
- Only happens on the wizard's in-screen Back button — hardware back / swipe / tab switch fire only once
- Both code paths exist; both produce the same user-visible UI

## Root Cause

Two code paths both observed "user is trying to exit with unsaved changes" and both implemented the prompt. The `beforeRemove` listener is the correct owner because it intercepts ALL exit paths — hardware back button, swipe-back gesture, tab switch, deep-link replace — not just the explicit in-wizard Back button. The child's prompt is redundant on the back-button path and absent on every other path.

## Solution

Remove the child's prompt entirely. The child just calls `onGoBack()` (or `navigation.goBack()`) and lets the parent's `beforeRemove` listener decide whether to prompt:

```typescript
// Wrong: child duplicates the prompt
if (currentStep === 1 && form.isDirty) {
  Alert.alert("Discard?", ..., [{ text: "Discard", onPress: onGoBack }]);
  return;
}
onGoBack();

// Right: child delegates; screen's beforeRemove is the sole owner
if (currentStep === 1) {
  onGoBack(); // beforeRemove will intercept if form is dirty
  return;
}
```

## Prevention

- When a screen uses `beforeRemove` to prompt for unsaved changes, child components must NOT duplicate the prompt.
- Single owner principle: exactly one component (the screen with `beforeRemove`) decides whether to prompt. Everyone else just triggers navigation.
- Audit any "Discard?" `Alert.alert` calls inside nested components — they are almost always wrong if the parent screen has a `beforeRemove`.

## Related Files

- `client/components/recipe-wizard/WizardShell.tsx` — removed duplicate Alert
- `client/screens/meal-plan/RecipeCreateScreen.tsx` — sole owner via `beforeRemove`
- `docs/patterns/react-native.md` — "Single Owner of Unsaved-Changes Prompt"

## See Also

- [Single owner unsaved-changes prompt](../conventions/single-owner-unsaved-changes-prompt-2026-05-13.md)
- [beforeRemove navigation guard with bottom sheet](../design-patterns/beforeremove-navigation-guard-bottom-sheet-2026-05-13.md)
