---
title: "FAB overlay with tab bar clearance via static constants"
track: knowledge
category: design-patterns
tags: [react-native, fab, tab-bar, layout, positioning]
module: client
applies_to:
  [
    "client/navigation/MainTabNavigator.tsx",
    "client/components/ScanFAB.tsx",
    "client/screens/**/*.tsx",
  ]
created: 2026-05-13
---

# FAB overlay with tab bar clearance via static constants

## When this applies

When adding a Floating Action Button (FAB) as a sibling to `Tab.Navigator`, use static layout constants instead of `useBottomTabBarHeight()`. The hook requires Tab.Navigator context and crashes when called from a sibling component.

## Examples

**Layout constants** (defined in `client/constants/theme.ts`):

```typescript
export const TAB_BAR_HEIGHT = Platform.select({ ios: 88, android: 72 }) ?? 88;
export const FAB_SIZE = 56;
export const FAB_CLEARANCE = FAB_SIZE + 16; // FAB size + gap
```

**FAB positioning** (sibling to Tab.Navigator, not a child):

```typescript
// MainTabNavigator.tsx
<View style={{ flex: 1 }}>
  <Tab.Navigator>{/* tabs */}</Tab.Navigator>
  <ScanFAB />  {/* sibling — cannot use useBottomTabBarHeight() here */}
</View>
```

```typescript
// ScanFAB.tsx — position relative to static tab bar height
<AnimatedPressable
  style={[styles.fab, { bottom: TAB_BAR_HEIGHT + Spacing.lg }]}
>
```

**Content clearance** — every tab screen must add `FAB_CLEARANCE` to its bottom padding so scrollable content isn't obscured:

```typescript
import { FAB_CLEARANCE } from "@/constants/theme";

<ScrollView
  contentContainerStyle={{
    paddingBottom: tabBarHeight + Spacing.xl + FAB_CLEARANCE,
  }}
/>
```

## Why

`useBottomTabBarHeight()` from `@react-navigation/bottom-tabs` only works inside components rendered as children of `Tab.Navigator` (tab screens). A FAB rendered as a sibling will crash with "No safe area value available" because the hook depends on Tab.Navigator context that doesn't exist at the sibling level. Static constants are reliable across all component positions. The values must be kept in sync with `Tab.Navigator`'s `tabBarStyle.height` — both reference `TAB_BAR_HEIGHT` from `theme.ts` to ensure a single source of truth.

## Exceptions

When to use: any persistent overlay (FAB, mini-player, banner) positioned above the tab bar but outside the tab navigator's component tree.

**No FAB on screens inside tab stacks:** The Scan FAB is rendered at the root level and floats over all tab content. Any screen that adds its own FAB in the same bottom-right position will overlap with the Scan FAB. Use header buttons, inline CTAs, or positioned differently (e.g., top-right) instead of adding a second FAB to screens within tab stacks.

## Related Files

- `client/constants/theme.ts` — `TAB_BAR_HEIGHT`, `FAB_SIZE`, `FAB_CLEARANCE`
- `client/navigation/MainTabNavigator.tsx` — FAB as sibling to Tab.Navigator
- `client/components/ScanFAB.tsx` — FAB component

## See Also

- [useBottomTabBarHeight for tab screen bottom padding](../conventions/usebottomtabbarheight-tab-screen-bottom-padding-2026-05-13.md)
