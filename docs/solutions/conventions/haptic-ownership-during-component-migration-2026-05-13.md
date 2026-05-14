---
title: "Haptic ownership during component migration — modal owns confirmation haptic"
track: knowledge
category: conventions
tags: [react-native, haptics, refactoring, components, ownership]
module: client
applies_to:
  [
    "client/components/**/*.tsx",
    "client/screens/**/*.tsx",
    "client/hooks/**/*.ts",
  ]
created: 2026-05-13
---

# Haptic ownership during component migration — modal owns confirmation haptic

## Rule

When migrating from `Alert.alert` (or any inline confirmation) to a shared confirmation component that owns its own haptic feedback, remove pre-existing haptics at the callsite to avoid double-buzz. The component that presents the confirmation owns the feedback timing.

## Examples

```typescript
// Confirmation modal handles its own haptics internally:
// - Warning haptic on destructive confirm tap
// - Selection haptic on cancel tap

// GOOD — callsite delegates haptics to the modal
const handleDelete = () => {
  confirm({
    onConfirm: () => deleteMutation.mutate(itemId),
  });
  // No haptics here — modal handles it
};

// BAD — double haptic (callsite + modal both fire)
const handleDelete = () => {
  haptics.notification(NotificationFeedbackType.Warning); // remove this
  confirm({
    onConfirm: () => deleteMutation.mutate(itemId),
  });
};
```

**Exception:** Post-mutation haptics in the `onConfirm` callback are the **caller's responsibility** — they fire at a different time and for a different purpose (success/failure feedback after the action completes, not the confirmation interaction itself).

```typescript
confirm({
  onConfirm: async () => {
    await deleteMutation.mutateAsync(itemId);
    haptics.notification(NotificationFeedbackType.Success); // caller owns post-mutation feedback
  },
});
```

## Why

Double-buzz feels broken — users feel two distinct vibrations for one interaction. Whoever presents the confirmation owns the confirmation haptic; the caller still owns the result haptic because that fires asynchronously after the user's interaction is over.

## Exceptions

When to use: any migration that moves user confirmation from an inline pattern to a shared component with built-in haptics.

When NOT to use: components that explicitly do NOT own haptic feedback (e.g., plain `Pressable` wrappers).

## Related Files

- `client/hooks/useConfirmationModal.ts` — owns warning haptic on destructive confirm
- Related: "Haptic Feedback on User Actions" and "Accessibility-Aware Haptics Pattern" in this file

## See Also

- [Haptic feedback on user actions](haptic-feedback-on-user-actions-2026-05-13.md)
- [Accessibility-aware haptics pattern](../design-patterns/accessibility-aware-haptics-pattern-2026-05-13.md)
- [beforeRemove navigation guard with bottom sheet](../design-patterns/beforeremove-navigation-guard-bottom-sheet-2026-05-13.md)
