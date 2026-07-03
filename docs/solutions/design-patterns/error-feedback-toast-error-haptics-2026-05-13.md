---
title: 'Error feedback: toast.error + haptics (not Alert.alert)'
track: knowledge
category: design-patterns
module: client
tags: [react-native, errors, toast, haptics, alert]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-05-13'
---

# Error feedback: toast.error + haptics (not Alert.alert)

## When this applies

For transient error states (failed API calls, network issues), use `toast.error()` with error haptics. Never use `Alert.alert("Error", ...)` for non-interactive error feedback — it blocks the UI and requires a tap to dismiss.

## Examples

```typescript
// GOOD — non-blocking, auto-dismisses, physical feedback
haptics.notification(Haptics.NotificationFeedbackType.Error);
toast.error("Failed to save recipe. Please try again.");

// BAD — blocks UI, no haptic feedback, inconsistent styling
Alert.alert("Error", "Failed to save recipe. Please try again.");
```

## Exceptions

When to use Alert.alert: Only for destructive confirmations that need explicit user consent (delete, discard, end fast). These require Cancel/Confirm buttons.

## Related Files

- `client/screens/FastingScreen.tsx` — error haptics on mutation failure
- `client/screens/CookSessionReviewScreen.tsx` — 3 mutation error paths
- `client/screens/ChatListScreen.tsx` — conversation creation error

## See Also

- [Toast with action button (Undo)](toast-with-action-button-undo-2026-05-13.md)
- [Query error retry pattern](query-error-retry-pattern-2026-05-13.md)
- [Inline validation errors](../conventions/inline-validation-errors-2026-05-13.md)
