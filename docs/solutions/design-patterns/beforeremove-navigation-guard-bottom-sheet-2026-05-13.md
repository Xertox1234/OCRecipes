---
title: "beforeRemove navigation guard with bottom sheet — capture action synchronously"
track: knowledge
category: design-patterns
tags: [react-native, navigation, bottom-sheet, beforeRemove, async]
module: client
applies_to: ["client/screens/**/*.tsx", "client/hooks/**/*.ts"]
created: 2026-05-13
---

# beforeRemove navigation guard with bottom sheet — capture action synchronously

## When this applies

When migrating `Alert.alert` inside `beforeRemove` navigation listeners to bottom sheets, capture the navigation action synchronously before opening the sheet. `Alert.alert` callbacks close over `e` naturally because the handler is synchronous. With an async bottom sheet, the event object may be stale by the time `onConfirm` fires.

## Examples

```typescript
// GOOD — capture action before presenting sheet
useEffect(() => {
  const unsubscribe = navigation.addListener("beforeRemove", (e) => {
    if (!form.isDirty) return;
    e.preventDefault();

    // Capture action NOW — e.data.action is only valid synchronously
    const action = e.data.action;
    confirm({
      title: "Discard changes?",
      message: "You have unsaved changes.",
      confirmLabel: "Discard",
      destructive: true,
      onConfirm: () => navigation.dispatch(action),
    });
  });
  return unsubscribe;
}, [navigation, form.isDirty, confirm]);

// BAD — e.data.action read asynchronously in closure
useEffect(() => {
  const unsubscribe = navigation.addListener("beforeRemove", (e) => {
    e.preventDefault();
    confirm({
      onConfirm: () => navigation.dispatch(e.data.action), // may be stale
    });
  });
  return unsubscribe;
}, [navigation, confirm]);
```

## Why

`Alert.alert` is synchronous — it blocks the JS thread and its callbacks run in the same event loop tick. Bottom sheets are async — `present()` returns immediately and `onConfirm` fires later. The navigation event's `data.action` must be captured in a local variable before the async gap.

## Exceptions

When to use: any screen migrating from `Alert.alert` to bottom sheet confirmations inside `beforeRemove` listeners.

## Related Files

- Related: "Unsaved Changes Navigation Guard" in `docs/legacy-patterns/documentation.md`
- `client/hooks/useConfirmationModal.ts` — `confirm()` pattern

## See Also

- [Haptic ownership during component migration](../conventions/haptic-ownership-during-component-migration-2026-05-13.md)
- [enableDynamicSizing for minimal-content sheets](enable-dynamic-sizing-minimal-content-sheets-2026-05-13.md)
- [Single owner of unsaved-changes prompt](../conventions/single-owner-unsaved-changes-prompt-2026-05-13.md)
