---
title: Dirty state sync via ref callbacks (child to parent without re-renders)
track: knowledge
category: design-patterns
module: client
tags: [react, refs, callbacks, beforeRemove, child-to-parent]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-13'
---

# Dirty state sync via ref callbacks (child to parent without re-renders)

## When this applies

When a child component (e.g., `WizardShell`) owns form state but the parent screen needs it for `beforeRemove` navigation guards, use callback props that write to `useRef` values in the parent. The ref avoids re-renders while keeping the `beforeRemove` listener fresh.

## Examples

```typescript
// Parent screen
const isDirtyRef = useRef(false);
const isSavingRef = useRef(false);

const handleDirtyChange = useCallback((dirty: boolean) => {
  isDirtyRef.current = dirty;
}, []);

useEffect(() => {
  const unsubscribe = navigation.addListener("beforeRemove", (e) => {
    if (isSavingRef.current) return;  // Let saves through
    if (!isDirtyRef.current) return;  // Clean form, let go

    e.preventDefault();
    Alert.alert("Discard changes?", "...", [
      { text: "Keep editing", style: "cancel" },
      { text: "Discard", style: "destructive",
        onPress: () => navigation.dispatch(e.data.action) },
    ]);
  });
  return unsubscribe;
}, [navigation]);

<WizardShell onDirtyChange={handleDirtyChange} onSavingChange={handleSavingChange} />
```

```typescript
// Child component (WizardShell)
useEffect(() => {
  onDirtyChange?.(form.isDirty);
}, [form.isDirty, onDirtyChange]);
```

## Why

The `beforeRemove` listener has `[navigation]` as its only dependency — it never re-subscribes. Using state would require adding `isDirty` to the dependency array, causing the listener to re-subscribe on every keystroke. Refs let the listener read the current value without re-subscribing.

## Exceptions

When to use: any screen where form state lives in a child component but the parent needs it for navigation guards, permission checks, or other cross-cutting concerns.

## Related Files

- `client/screens/meal-plan/RecipeCreateScreen.tsx`
- `client/components/recipe-wizard/WizardShell.tsx`

## See Also

- [Single-screen wizard with Reanimated transitions](single-screen-wizard-reanimated-transitions-2026-05-13.md)
- [Single owner of unsaved-changes prompt](../conventions/single-owner-unsaved-changes-prompt-2026-05-13.md)
- [beforeRemove navigation guard with bottom sheet](beforeremove-navigation-guard-bottom-sheet-2026-05-13.md)
