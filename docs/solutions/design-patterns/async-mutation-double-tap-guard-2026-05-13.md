---
title: "Async mutation double-tap guard via useRef(false)"
track: knowledge
category: design-patterns
tags: [react-native, mutation, debouncing, useref, race-condition]
module: client
applies_to: ["client/components/**/*.tsx", "client/screens/**/*.tsx"]
created: 2026-05-13
---

# Async mutation double-tap guard via useRef(false)

## When this applies

For mutation handlers in bottom sheets or modals where rapid taps can fire duplicate requests, use a `useRef(false)` guard instead of relying on button `disabled` state (which may not update fast enough).

## Examples

```tsx
// client/components/meal-plan/QuickAddSheet.tsx
const isAdding = useRef(false);

const handleAdd = useCallback(
  async (recipe: RecipeRow) => {
    if (!mealType || isAdding.current) return;
    isAdding.current = true;
    haptics.impact(ImpactFeedbackStyle.Light);
    try {
      await addItemMutation.mutateAsync({
        recipeId: recipe.id,
        plannedDate,
        mealType,
      });
      haptics.notification(NotificationFeedbackType.Success);
      onDismiss();
    } catch {
      // Mutation errors handled by React Query
    } finally {
      isAdding.current = false;
    }
  },
  [mealType, plannedDate, haptics, addItemMutation, onDismiss],
);
```

## Why

`disabled` prop relies on a state update → re-render cycle, which can lag behind rapid taps. A ref check is synchronous and prevents the second tap from ever entering the async path.

## Exceptions

When to use:

- Tap-to-add in lists/sheets where each row triggers a mutation
- Any `mutateAsync` handler without a loading spinner that disables the trigger

When NOT to use:

- Buttons that already show a loading state and are properly `disabled` during mutation
- Forms with a single submit button (use `isPending` from mutation)

## Related Files

- `client/components/meal-plan/QuickAddSheet.tsx` — `isAdding` ref guard on recipe add

## See Also

- [Use useRef for synchronous checks in callbacks](../conventions/useref-for-synchronous-checks-in-callbacks-2026-05-13.md)
- [Async operation with timeout fallback + race condition guard](async-operation-timeout-fallback-race-guard-2026-05-13.md)
