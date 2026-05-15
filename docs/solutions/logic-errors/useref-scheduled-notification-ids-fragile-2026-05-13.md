---
title: "useRef for scheduled notification IDs leaks orphans across remounts"
track: bug
category: logic-errors
tags: [expo-notifications, useref, react-native, component-lifecycle]
module: client
applies_to: ["client/screens/FastingScreen.tsx"]
symptoms:
  - "Notifications fire after the user ended the fast"
  - "ID list is empty when handleEndFast tries to cancel"
  - "Bug only reproduces after navigating away and back"
created: 2026-03-21
severity: medium
---

# useRef for scheduled notification IDs leaks orphans across remounts

## Problem

`FastingScreen` stored `expo-notifications` scheduled IDs in `useRef<string[]>([])` so they could be cancelled when the user ended the fast. When the user navigated away and returned, the screen unmounted and remounted — the ref was reset to `[]`, leaving orphaned notifications that fired after the fast ended.

## Symptoms

- Push notifications appear after the fast was officially ended
- `handleEndFast` finds an empty ID list and cancels nothing
- Reliable repro: schedule fast → navigate away → come back → end fast

## Root Cause

`useRef` state is tied to the component instance. Unmount destroys the ref; remount creates a fresh empty one. Persistent OS-level state (scheduled notifications) outlives the React component.

## Solution

Use `Notifications.cancelAllScheduledNotificationsAsync()` instead of ID-based tracking. It is a platform-level operation that survives unmount, app backgrounding, and force-quit recovery:

```typescript
// Bad — IDs lost on unmount
const notificationIdsRef = useRef<string[]>([]);
// ... schedule, collect IDs ...
// On end: cancelFastingNotifications(notificationIdsRef.current)  // empty after remount

// Good — platform-level cancel
await Notifications.cancelAllScheduledNotificationsAsync();
```

## Prevention

- For state that must outlive the React component (OS-level resources), use platform APIs that operate on the resource directly.
- If selective cancellation is needed later (multiple notification categories), persist IDs to AsyncStorage or use notification categories/channels — not a ref.

## Caveat

`cancelAllScheduledNotificationsAsync()` cancels **all** scheduled notifications, not just fasting ones. This is acceptable while fasting is the only notification source. When other categories are added, switch to category-scoped cancellation.

## Related Files

- `client/screens/FastingScreen.tsx` — `handleEndFast` uses global cancel

## See Also

- [expo-notifications API](https://docs.expo.dev/versions/latest/sdk/notifications/)
