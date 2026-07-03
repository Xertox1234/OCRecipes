---
title: alert-role-and-live-region-do-not-announce-on-ios
track: knowledge
category: conventions
module: client
tags: [react-native, accessibility, voiceover, live-region, ios, error-handling]
applies_to: [client/components/**/*.tsx, client/screens/**/*.tsx]
created: '2026-05-28'
---

## Rule

Neither `accessibilityRole="alert"` nor `accessibilityLiveRegion="assertive"` causes an automatic VoiceOver announcement on iOS. `accessibilityLiveRegion` is Android-only, and the `alert` role on iOS only affects focus/traits — it does **not** post a `UIAccessibilityAnnouncementNotification`. Therefore, an error banner that renders with `role="alert"` + `live-region` will announce on Android (via live‑region) but is **silent** on iOS.

To ensure VoiceOver announces error messages on iOS:

- Keep an explicit `AccessibilityInfo.announceForAccessibility(msg)` call gated to `Platform.OS === 'ios'`.
- Place the announce inside the mutation’s `onError` handler (tied to the failure event, fires exactly once per failure) rather than in a `useEffect` keyed on `isError` (which can re‑fire on unrelated re‑renders or stale states across re‑mounts).
- Do **not** rely on the `alert` role or `liveRegion` prop to trigger an announcement on iOS.

## Why

This convention was discovered during implementation of “Mutations with no user‑visible error feedback”. The concrete trap that prompted this: removing the iOS‑only `announceForAccessibility` on the assumption that the `alert`‑role banner covers iOS — it does **not**; that silently regresses iOS VoiceOver. Android already announces via the live‑region, so the iOS‑only gate prevents double announcements.

## Examples

### ✅ Good (cross‑platform with correct iOS handling)

```tsx
const onError = (error: Error) => {
  haptics.notification('Error'); // or equivalent
  if (Platform.OS === 'ios') {
    AccessibilityInfo.announceForAccessibility(
      error instanceof Error ? error.message : 'Something went wrong'
    );
  }
};

// Banner uses both alert role and liveRegion for Android
<View
  accessibilityRole="alert"
  accessibilityLiveRegion="assertive"
  // ... rest of error banner
/>
```

### ❌ Bad (silent on iOS)

```tsx
// Only relying on role/liveRegion – no iOS announcement
<View
  accessibilityRole="alert"
  accessibilityLiveRegion="assertive"
>
  <Text>{errorMessage}</Text>
</View>
// This works on Android but is completely silent on iOS.
```

### ❌ Bad (useEffect may fire multiple times)

```tsx
// useEffect keyed on isError – can re‑announce on re‑renders
useEffect(() => {
  if (isError) {
    AccessibilityInfo.announceForAccessibility(errorMessage);
  }
}, [isError, errorMessage]);
```

## Related Files

- `client/components/RecipeGenerationModal.tsx`

## See Also

- [../design-patterns/cross-platform-live-region-announcements-2026-05-13.md]()
- [docs/rules/accessibility.md]()
