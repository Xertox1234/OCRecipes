---
title: iOS-only contentInsetAdjustmentBehavior as the sole header-inset fix leaves Android content under the transparent header
track: bug
category: logic-errors
module: client
severity: medium
tags: [react-native, scrollview, platform-parity, transparent-header, navigation]
symptoms: [First list row hidden/clipped behind the nav header on Android while iOS looks fixed, A ScrollView fix that "works in the simulator" but the bug report reproduces on Android, contentInsetAdjustmentBehavior="automatic" present with no paddingTop/useHeaderHeight on the same scroll content]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-07-02'
---

# iOS-only contentInsetAdjustmentBehavior as the sole header-inset fix leaves Android content under the transparent header

## Problem

PR #483 fixed "Edit Profile hidden behind the Settings header" by adding
`contentInsetAdjustmentBehavior="automatic"` to the Settings `ScrollView`. The prop maps
directly to `UIScrollView.contentInsetAdjustmentBehavior` — it is a **no-op on Android**.
`useScreenOptions()` sets `headerTransparent: true` unconditionally on **both** platforms,
so the identical hidden-first-row bug stayed live on Android while iOS looked fixed.

## Symptoms

- First row of a scrollable screen renders behind the transparent nav header on Android only
- The fix verifies on the iOS Simulator; Android emulator/device still shows the overlap
- No compiler, lint, or runtime warning — the prop type-checks and silently does nothing on Android

## Root Cause

React Native's `ScrollView` accepts several iOS-only props (`contentInsetAdjustmentBehavior`,
`contentInset`, `automaticallyAdjustScrollIndicatorInsets`) that are ignored on Android with
no feedback. The header overlap itself is cross-platform: react-navigation native-stack v7
honors `headerTransparent: true` on Android too, so content lays out at y=0 under the header
on both platforms. Fixing it with an iOS-only knob repairs exactly half the bug.

## Solution

Use the app-wide cross-platform mechanism instead — read the real header height and pad the
scroll content (the convention already used by 22 screens):

```tsx
import { useHeaderHeight } from "@react-navigation/elements";

const headerHeight = useHeaderHeight();

<ScrollView
  contentContainerStyle={{
    paddingTop: headerHeight, // add + Spacing.* only if no first-child margin provides the gap
    paddingBottom: insets.bottom + Spacing.xl,
  }}
>
```

Fixed in commit `b5dce2b2` (`client/screens/SettingsScreen.tsx`). The only sanctioned use of
`contentInsetAdjustmentBehavior` in this codebase is `"never"` to *opt out* of automatic
insets on modal hero screens (`FeaturedRecipeDetailScreen`, `RecipeDetailContent`).

## Prevention

- When a diff fixes a layout/inset/keyboard issue with any iOS-only ScrollView prop, demand
  Android parity: either the bug is provably iOS-only, or the fix must use a cross-platform
  mechanism (`useHeaderHeight()` + `paddingTop`, safe-area insets).
- Root cause is systemic: `useScreenOptions()` defaults `headerTransparent: true`, forcing a
  per-screen inset workaround on every list screen. A shared owner for the inset is tracked in
  `todos/P3-2026-07-02-shared-header-inset-mechanism.md`.

## Related Files

- `client/screens/SettingsScreen.tsx` — the fixed screen
- `client/hooks/useScreenOptions.ts` — `transparent = true` default (root cause)
- `client/screens/SavedItemsScreen.tsx`, `client/screens/HistoryScreen.tsx` — canonical `useHeaderHeight()` examples

## See Also

- [cross-link](../conventions/a11y-hide-visually-hidden-surfaces-2026-06-10.md) — another class of "renders fine, but a platform/AT surface disagrees" defect
