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
last_updated: '2026-07-05'
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

As of 2026-07-05 the app-wide cross-platform mechanism is `useHeaderContentInset()`
(`client/hooks/useHeaderContentInset.ts`), a thin wrapper around `useHeaderHeight()` — or the
`ScreenScrollView` wrapper (`client/components/ScreenScrollView.tsx`) for a plain `ScrollView`
screen. Prefer these over importing `useHeaderHeight` directly and hand-rolling the math:

```tsx
import { useHeaderContentInset } from "@/hooks/useHeaderContentInset";

const headerInset = useHeaderContentInset(Spacing.xl); // headerHeight + Spacing.xl

<ScrollView
  contentContainerStyle={{
    paddingTop: headerInset,
    paddingBottom: insets.bottom + Spacing.xl,
  }}
>

// or, for a plain ScrollView screen:
import { ScreenScrollView } from "@/components/ScreenScrollView";

<ScreenScrollView
  headerInsetExtra={Spacing.xl}
  contentContainerStyle={{ paddingBottom: insets.bottom + Spacing.xl }}
>
```

Fixed in commit `b5dce2b2` (`client/screens/SettingsScreen.tsx`), then centralized in
`todos/archive/P3-2026-07-02-shared-header-inset-mechanism.md`. The only sanctioned use of
`contentInsetAdjustmentBehavior` in this codebase is `"never"` to *opt out* of automatic
insets on modal hero screens (`FeaturedRecipeDetailScreen`, `RecipeDetailContent`).

## Prevention

- When a diff fixes a layout/inset/keyboard issue with any iOS-only ScrollView prop, demand
  Android parity: either the bug is provably iOS-only, or the fix must use a cross-platform
  mechanism (`useHeaderContentInset()` / `ScreenScrollView`, safe-area insets).
- `useScreenOptions()` still defaults `headerTransparent: true`, so any new scrollable screen
  needs the inset. Reach for `useHeaderContentInset()` (or `ScreenScrollView` for a plain
  `ScrollView`) rather than importing `useHeaderHeight` directly and hand-rolling
  `paddingTop` math — see `docs/rules/react-native.md`. Migration to the shared mechanism is
  staged (5 of 23 screens as of 2026-07-05); a screen still on the raw `useHeaderHeight()`
  pattern isn't wrong, just not yet migrated.

## Related Files

- `client/hooks/useHeaderContentInset.ts` — the canonical inset hook
- `client/components/ScreenScrollView.tsx` — the `ScrollView` wrapper built on that hook
- `client/screens/SettingsScreen.tsx` — the originally-fixed screen, now migrated to `ScreenScrollView`
- `client/hooks/useScreenOptions.ts` — `transparent = true` default (root cause)
- `client/screens/SavedItemsScreen.tsx`, `client/screens/meal-plan/PantryScreen.tsx` — canonical `useHeaderContentInset()` examples for `FlatList`/`SectionList` screens

## See Also

- [cross-link](../conventions/a11y-hide-visually-hidden-surfaces-2026-06-10.md) — another class of "renders fine, but a platform/AT surface disagrees" defect
