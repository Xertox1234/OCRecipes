---
title: "Add network/offline state indicator"
status: done
priority: medium
created: 2026-03-24
updated: 2026-03-24
assignee:
labels: [usability, ux, network]
---

# Add Network/Offline State Indicator

## Summary

Add a visual indicator when the device loses network connectivity, and show contextual error messages that distinguish network failures from bugs.

## Background

Users in poor connectivity situations (common on mobile) see generic "Failed to..." error toasts with no way to distinguish a bug from a network issue. They may repeatedly retry operations that can't succeed without connectivity.

## Acceptance Criteria

- [x] Install `@react-native-community/netinfo`
- [x] Create `useNetworkStatus()` hook that tracks online/offline state
- [x] Show a persistent banner at top of screen when offline (below safe area, above content)
- [x] Banner is accessible: `accessibilityRole="alert"`, `accessibilityLiveRegion="assertive"`
- [x] Optionally disable mutation buttons when offline to prevent futile requests — `useNetworkStatus()` exposes `isOffline` for consumers to use
- [x] Banner auto-dismisses when connectivity returns (with brief "Back online" success toast)
- [x] Banner uses theme colors and respects reducedMotion for enter/exit animation

## Implementation Notes

- `@react-native-community/netinfo` provides `addEventListener` for connectivity changes
- Banner should be rendered at the root level (inside `ToastProvider`, above `NavigationContainer`)
- Consider a `NetworkProvider` context wrapping the app
- The banner should be visually distinct from toasts (persistent vs auto-dismissing)
- Reference: The existing `Toast` component for animation patterns and accessibility

## Dependencies

- `@react-native-community/netinfo` package (needs install)

## Updates

### 2026-03-24

- Created from full frontend usability review
