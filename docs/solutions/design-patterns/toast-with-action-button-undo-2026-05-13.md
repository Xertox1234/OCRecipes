---
title: Toast with action button (Undo)
track: knowledge
category: design-patterns
module: client
tags: [react-native, toast, undo, accessibility, ux]
applies_to: [client/components/**/*.tsx, client/context/**/*.tsx]
created: '2026-05-13'
---

# Toast with action button (Undo)

## When this applies

The Toast system supports an optional action button for recoverable operations. Pass `action: { label, onPress }` to any toast method. Auto-dismiss extends from 3s to 5s when an action is present. iOS VoiceOver announces the action availability.

**Known gap (2026-07-13):** the announcement is not backed by a reachable control — see [../logic-errors/toast-action-button-unreachable-by-screen-reader-2026-07-13.md](../logic-errors/toast-action-button-unreachable-by-screen-reader-2026-07-13.md). Don't rely on this pattern for a screen-reader-critical action until that's fixed; keep an independently-reachable on-screen control as the primary path, as `LabelAnalysisScreen.tsx`'s retry button does.

## Examples

```typescript
const toast = useToast();

// After a destructive action that can be undone:
toast.success("Item removed", {
  action: { label: "Undo", onPress: () => restoreItem(itemId) },
});
```

## Related Files

- `client/components/Toast.tsx` — action button rendering, 5s dismiss
- `client/components/toast-utils.ts` — `ToastAction` interface
- `client/context/ToastContext.tsx` — `ToastOptions` with action support

## See Also

- [Error feedback: toast.error + haptics](error-feedback-toast-error-haptics-2026-05-13.md)
