---
title: "Android: tab bar labels sit under the system navigation buttons"
status: backlog
priority: medium
created: 2026-10-27
updated: 2026-10-27
assignee:
labels: [deferred, mobile, android, navigation]
github_issue:
---

# Android: tab bar labels sit under the system navigation buttons

## Summary

On an Android phone with 3-button navigation, the Home / Plan / Coach / Profile labels are drawn underneath the system's ||| ○ < buttons. Make the Android tab bar tall enough to hold its icons and labels above the navigation bar.

## Background

Seen on a Samsung Galaxy A37, Android 16, 3-button navigation, 2026-10-27 (during the modal-toast Android check). `client/navigation/MainTabNavigator.tsx` sets `tabBarStyle.height: TAB_BAR_HEIGHT`, which is `72` on Android (`client/constants/theme.ts:138`). React Navigation's bottom tabs add the safe-area bottom inset as padding inside the bar, but a fixed `height` doesn't grow to fit it, so the 3-button bar (~48 dp) eats most of the 72 dp and the labels land under it. Android is edge-to-edge (mandatory in this Expo SDK), so the app draws behind the navigation bar.

## Acceptance Criteria

- [ ] On an Android phone with 3-button navigation, tab icons and labels are fully above the system buttons.
- [ ] With gesture navigation (thin handle), the bar doesn't gain a large empty gap.
- [ ] iOS tab bar unchanged (sim screenshot).
- [ ] Screens that pad their content by `TAB_BAR_HEIGHT` (grep it) still clear the bar on Android — the last list item isn't hidden behind it.

## Implementation Notes

- Likely shape: on Android, `height: TAB_BAR_HEIGHT + insets.bottom` (React Navigation's `useSafeAreaInsets`), or drop the fixed height on Android and let the library size it. Check what other screens use `TAB_BAR_HEIGHT` / `useBottomTabBarHeight` for bottom padding before choosing — `useBottomTabBarHeight` reads the real height, a raw `TAB_BAR_HEIGHT` doesn't.
- Verify on the phone with `adb exec-out screencap -p`; a change to the navigator may need a force-stop + relaunch to load on the phone.

## Scope Contract

- **Mechanisms to use:** the existing safe-area insets; no new layout component.
- **Files in scope:** `client/navigation/MainTabNavigator.tsx`, `client/constants/theme.ts`, and any screen that pads by `TAB_BAR_HEIGHT` if it must change with it.

## Updates

### 2026-10-27

- Filed from a phone screenshot of the Home tab (labels under the nav buttons).
