---
title: "Safe area handling with useSafeAreaInsets() and theme spacing"
track: knowledge
category: conventions
tags: [react-native, safe-area, layout, theme]
module: client
applies_to: ["client/screens/**/*.tsx", "client/components/**/*.tsx"]
created: 2026-05-13
---

# Safe area handling with useSafeAreaInsets() and theme spacing

## Rule

Always use `useSafeAreaInsets()` for screen layouts. Add theme spacing (`Spacing.lg`, `Spacing.xl`) on top of the inset to provide visual breathing room beyond the hardware safe area.

## Examples

```typescript
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function MyScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();

  return (
    <ScrollView
      contentContainerStyle={{
        paddingTop: headerHeight + Spacing.lg,
        paddingBottom: insets.bottom + Spacing.xl,
      }}
    >
      {/* Content */}
    </ScrollView>
  );
}
```

## Why

Handles iOS notch, Dynamic Island, and home indicator. Adding theme spacing provides visual breathing room beyond the safe area so content does not sit flush against system UI.

## Exceptions

For tab screens, use `useBottomTabBarHeight()` instead — the tab bar (~88pt) is much taller than the bottom safe area inset (~34pt) and content will be hidden behind the bar with `insets.bottom` alone.

## See Also

- [useBottomTabBarHeight for tab screen bottom padding](usebottomtabbarheight-tab-screen-bottom-padding-2026-05-13.md)
- [FAB overlay with tab bar clearance](../design-patterns/fab-overlay-tab-bar-clearance-2026-05-13.md)
