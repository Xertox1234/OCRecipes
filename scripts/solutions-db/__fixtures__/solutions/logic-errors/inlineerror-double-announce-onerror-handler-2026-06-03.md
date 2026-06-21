---
title: InlineError + onError announceForAccessibility causes double VoiceOver announce
track: bug
category: logic-errors
module: client
severity: medium
tags: [accessibility, react-native, voiceover, talkback, inline-error, announceForAccessibility]
symptoms:
  [
    VoiceOver reads the error message twice in rapid succession after a mutation fails,
    TalkBack reads the error message twice after a failed save,
    "Two different error strings are spoken — one from the onError handler, one from InlineError",
  ]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: "2026-06-03"
---

# InlineError + onError announceForAccessibility causes double VoiceOver announce

## Problem

A screen uses `InlineError` to display mutation errors and also calls `AccessibilityInfo.announceForAccessibility()` directly in the mutation's `onError` handler. This causes the error to be announced twice:

- **iOS**: `InlineError` fires its own `Platform.OS === "ios"` gated `announceForAccessibility(message)` in a `useEffect` when `message` changes. The `onError` handler fires a second `announceForAccessibility` call. VoiceOver reads both.
- **Android**: `InlineError` has `accessibilityRole="alert"` + `accessibilityLiveRegion="assertive"` which TalkBack announces automatically. An ungated `announceForAccessibility` in `onError` fires a second TalkBack announcement.

The two strings often differ (e.g., `"Failed to log weight"` vs `"Couldn't save your weight. Please try again."`), compounding the confusion.

## Symptoms

- Screen reader user hears the same error concept spoken twice after a failed save/submit
- The two spoken strings are different (one from the handler, one from InlineError's message prop)
- Only manifests on mutation errors — success paths are unaffected

## Root Cause

`InlineError` already encapsulates full cross-platform announce logic:

```tsx
// InlineError.tsx — existing iOS announce built-in
useEffect(() => {
  if (message && Platform.OS === "ios") {
    AccessibilityInfo.announceForAccessibility(message);
  }
}, [message]);

// + accessibilityRole="alert" + accessibilityLiveRegion="assertive" for Android
```

Callers who add their own `announceForAccessibility` in `onError` are unaware that `InlineError` already handles both platforms.

## Solution

When using `InlineError` to display a mutation error, **do not** call `announceForAccessibility` in the `onError` handler. Delegate the announce to `InlineError` by setting the error state that feeds its `message` prop:

```tsx
// Bad — double announce on both platforms
onError: () => {
  setWeightError("Couldn't save your weight. Please try again.");
  haptics.notification(Haptics.NotificationFeedbackType.Error);
  AccessibilityInfo.announceForAccessibility("Failed to log weight"); // <- remove this
},

// Good — InlineError handles iOS + Android announce
onError: () => {
  setWeightError("Couldn't save your weight. Please try again.");
  haptics.notification(Haptics.NotificationFeedbackType.Error);
},
```

The `InlineError` component fires `announceForAccessibility(message)` on iOS and uses `accessibilityRole="alert"` + `accessibilityLiveRegion="assertive"` on Android — both platforms get exactly one announcement.

## Prevention

- When an error is displayed via `InlineError`, treat `InlineError` as the sole announce owner for that error
- Only add `announceForAccessibility` in `onError` for errors that are NOT surfaced via `InlineError` (e.g., toast-style errors without a persistent display component)
- The accessibility rule "async state transitions must call `announceForAccessibility` on iOS" has an implicit assumption: the error display component does not already announce. `InlineError` does announce — so the rule's conclusion (add a call) inverts

## Related Files

- `client/components/InlineError.tsx`
- `client/screens/WeightTrackingScreen.tsx`
- `docs/rules/accessibility.md`

## See Also

- [Double TalkBack announcements -- live region + announceForAccessibility](double-talkback-announcements-live-region-2026-05-13.md)
- [Cross-platform live region announcements](../design-patterns/cross-platform-live-region-announcements-2026-05-13.md)
