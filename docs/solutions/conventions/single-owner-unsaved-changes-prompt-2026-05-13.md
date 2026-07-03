---
title: 'Single owner of unsaved-changes prompt — beforeRemove on the screen, not the child'
track: knowledge
category: conventions
module: client
tags: [react-native, navigation, beforeRemove, alert, unsaved-changes]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-05-13'
---

# Single owner of unsaved-changes prompt — beforeRemove on the screen, not the child

## Rule

When a screen uses a `beforeRemove` navigation listener to prompt for unsaved changes, the child component must NOT also show its own discard Alert for the same condition. The two prompts chain: the child's Alert fires, user taps Discard, the onDismiss callback calls `navigation.goBack()`, and the screen's `beforeRemove` re-fires showing an identical second Alert.

## Examples

```typescript
// Bad: child component duplicates the prompt
// WizardShell.tsx
const goBack = useCallback(() => {
  if (currentStep === 1) {
    if (form.isDirty) {
      Alert.alert("Discard changes?", "...", [
        { text: "Cancel", style: "cancel" },
        { text: "Discard", style: "destructive", onPress: onGoBack },
      ]);
      return;
    }
    onGoBack();
  }
}, [currentStep, form.isDirty, onGoBack]);

// RecipeCreateScreen.tsx — ALSO shows an Alert via beforeRemove
navigation.addListener("beforeRemove", (e) => {
  if (isDirtyRef.current) {
    e.preventDefault();
    Alert.alert("Discard changes?", "...", ...); // fires AFTER WizardShell's
  }
});
```

```typescript
// Good: child just delegates; screen's beforeRemove is the sole owner
// WizardShell.tsx
const goBack = useCallback(() => {
  if (currentStep === 1) {
    // Screen-level beforeRemove listener owns the unsaved-changes prompt;
    // delegating here avoids a double-alert on discard.
    onGoBack();
    return;
  }
  // ... step-back within wizard
}, [currentStep, onGoBack]);
```

## Why

`beforeRemove` intercepts all exit paths — hardware back button, swipe-back gesture, tab switch, deep-link replace — not just the explicit "Back" button in the child. Putting the prompt in the screen guarantees one code path handles every exit.

## Related Files

- 2026-04-17 audit H13 — WizardShell and RecipeCreateScreen both had discard Alerts. Tapping the in-wizard Back on step 1 fired the wizard's Alert; Discard called `onGoBack()` → `navigation.goBack()` → `beforeRemove` → second identical Alert.

## See Also

- [Dirty state sync via ref callbacks](../design-patterns/dirty-state-sync-ref-callbacks-2026-05-13.md)
- [beforeRemove navigation guard with bottom sheet](../design-patterns/beforeremove-navigation-guard-bottom-sheet-2026-05-13.md)
- [Single-screen wizard with Reanimated transitions](../design-patterns/single-screen-wizard-reanimated-transitions-2026-05-13.md)
