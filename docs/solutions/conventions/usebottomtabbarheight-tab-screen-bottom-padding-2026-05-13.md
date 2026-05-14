---
title: "Use useBottomTabBarHeight() for tab screen bottom padding"
track: knowledge
category: conventions
tags: [react-native, tab-bar, safe-area, layout, padding]
module: client
applies_to: ["client/screens/**/*.tsx"]
created: 2026-05-13
---

# Use useBottomTabBarHeight() for tab screen bottom padding

## Rule

Screens rendered inside a tab navigator must use `useBottomTabBarHeight()` from `@react-navigation/bottom-tabs` for bottom content padding — not `useSafeAreaInsets().bottom`. The tab bar is significantly taller than the safe area inset (88pt vs ~34pt on iPhone with home indicator), so using `insets.bottom` leaves content hidden behind the tab bar.

## Examples

```typescript
// GOOD: Correct bottom padding inside tab screens
import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import { FAB_CLEARANCE, Spacing } from "@/constants/theme";

function MyTabScreen() {
  const tabBarHeight = useBottomTabBarHeight();

  return (
    <ScrollView
      contentContainerStyle={{
        paddingBottom: tabBarHeight + Spacing.xl + FAB_CLEARANCE,
      }}
    />
  );
}
```

```typescript
// BAD: Content hidden behind tab bar
import { useSafeAreaInsets } from "react-native-safe-area-context";

function MyTabScreen() {
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      contentContainerStyle={{
        paddingBottom: insets.bottom + Spacing.xl, // ~34pt — tab bar is 88pt!
      }}
    />
  );
}
```

## Why

`useBottomTabBarHeight()` returns the actual measured tab bar height including safe area padding. `useSafeAreaInsets().bottom` only returns the hardware safe area (home indicator), which is a subset of the tab bar height.

## Exceptions

When to use: any screen rendered as a direct child of `Tab.Navigator` that has scrollable content.

When NOT to use: screens inside modal stacks or root-level stacks that don't have a tab bar. Also cannot be used in FAB siblings — see related FAB pattern for that case.

## See Also

- [FAB overlay with tab bar clearance](../design-patterns/fab-overlay-tab-bar-clearance-2026-05-13.md)
- [Safe area handling](safe-area-handling-2026-05-13.md)
