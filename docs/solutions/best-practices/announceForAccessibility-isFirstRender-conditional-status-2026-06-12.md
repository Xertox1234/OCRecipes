---
title: Use announceForAccessibility with isFirstRender guard for conditional status nodes
track: knowledge
category: best-practices
module: client
tags: [accessibility, announceForAccessibility, react-native, screen-reader, offline, status]
applies_to: [client/screens/*.tsx, client/components/*.tsx]
created: '2026-06-12'
last_updated: '2026-06-20'
---

# Use announceForAccessibility with isFirstRender guard for conditional status nodes

## Rule

When a status node (banner, inline note, error message) appears or disappears based on runtime state, call `AccessibilityInfo.announceForAccessibility` in a `useEffect` with an `isFirstRender` ref guard. Do **not** add `accessibilityLiveRegion` to the same node.

**Exception — the offline transition is already announced globally.** The always-mounted global `OfflineBanner` (`client/components/OfflineBanner.tsx`) announces the offline transition on **both** platforms by itself: iOS via its own `announceForAccessibility(OFFLINE_MESSAGE)` effect, Android via its rendered banner's `accessibilityRole="alert"` + `accessibilityLiveRegion="assertive"`. Because that banner is mounted app-wide (in `App.tsx`), a screen must **not** add its own per-screen offline announce — doing so makes a screen-reader user hear the transition **twice** (cross-component double-announce, with differing copy). This is distinct from the same-node `accessibilityLiveRegion` + `announceForAccessibility` double-announce: here two *separate* components announce the same transition. For the offline state specifically, rely on the global banner and add no per-screen announce. (HistoryScreen, NutritionDetailScreen, and QuickLogScreen previously each added a redundant offline announce — removed 2026-06-20.)

## Why

Screen readers (VoiceOver on iOS, TalkBack on Android) do not automatically announce newly-rendered text. Without an explicit announcement, a user who is already on a screen when the offline state changes receives no feedback — the banner appears visually but is silent to them.

`accessibilityLiveRegion` is an Android-only attribute and causes **double announcements on Android** when paired with `AccessibilityInfo.announceForAccessibility`. The project rule: use `announceForAccessibility` only, never both.

The `isFirstRender` guard is required because `useEffect` fires on mount as well as on change. Without the guard, the announcement fires immediately when the screen mounts — even if the device was already offline — which is both noisy and semantically wrong ("you're offline" should be news, not a greeting).

## Examples

```tsx
import { AccessibilityInfo } from "react-native";
import { useRef, useEffect } from "react";
import { useOfflineGuard } from "@/hooks/useOfflineGuard";

function MyScreen() {
  const { isOffline } = useOfflineGuard();

  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    if (isOffline) {
      AccessibilityInfo.announceForAccessibility(
        "You're offline. This will sync when you reconnect.",
      );
    }
  }, [isOffline]);

  return (
    <>
      {isOffline && (
        // NO accessibilityLiveRegion here — announceForAccessibility handles it
        <ThemedText type="small" style={{ color: theme.textSecondary }}>
          You&apos;re offline. This will sync when you reconnect.
        </ThemedText>
      )}
      {/* rest of screen */}
    </>
  );
}
```

**Wrong — paired with `accessibilityLiveRegion` (double TalkBack announcement):**
```tsx
<ThemedText accessibilityLiveRegion="polite">  {/* ← do NOT add this */}
  You&apos;re offline.
</ThemedText>
```

**Wrong — no isFirstRender guard (fires on mount):**
```tsx
useEffect(() => {
  if (isOffline) {  // ← fires immediately if device is already offline
    AccessibilityInfo.announceForAccessibility("You're offline.");
  }
}, [isOffline]);
```

## Smell patterns

- A conditional `ThemedText`/`View` that appears based on a state transition (offline, error, success) with no corresponding `useEffect`
- `accessibilityLiveRegion` on a node that also has a sibling `announceForAccessibility` call
- A per-screen offline `announceForAccessibility` effect when the global `OfflineBanner` is already mounted app-wide — the transition is announced twice (see the Rule's exception)

## Exceptions

`accessibilityLiveRegion="polite"` alone (without `announceForAccessibility`) is appropriate for Android-only scenarios where you need live region semantics for a node that is always rendered but whose text changes (e.g. a counter that updates in place). Use `accessibilityLiveRegion` only when you are NOT also calling `announceForAccessibility` for the same state change.

## Related Files

- `client/components/OfflineBanner.tsx` — global, always-mounted offline announcer (iOS `announceForAccessibility` + Android assertive live region); the single canonical offline announcement
- `client/screens/NutritionDetailScreen.tsx` — inline offline note; per-screen offline announce removed (relies on global banner)
- `client/screens/QuickLogScreen.tsx` — inline offline note; per-screen offline announce removed (relies on global banner)
- `client/screens/HistoryScreen.tsx` — top-of-list offline banner + isError announce effect; per-screen offline announce removed (relies on global banner)
- `client/hooks/useOfflineGuard.ts` — exposes `isOffline` consumed by all three screens

## See Also

- [double-talkback-announcements-live-region-2026-05-13.md](../logic-errors/double-talkback-announcements-live-region-2026-05-13.md) — root cause of the double-announcement when pairing both mechanisms
