---
title: CompositeNavigationProp for cross-stack navigation
track: knowledge
category: design-patterns
module: client
tags: [react-native, navigation, typescript, composite-types]
applies_to: [client/types/navigation.ts, client/screens/**/*.tsx]
created: '2026-05-13'
---

# CompositeNavigationProp for cross-stack navigation

## When this applies

When navigating from one tab stack to a screen in another tab stack, use `CompositeNavigationProp`. Standard `NativeStackNavigationProp` only knows about screens in its own stack.

## Examples

```typescript
import {
  CompositeNavigationProp,
  useNavigation,
} from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";

// Define the composite type for cross-tab navigation
type HistoryScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<HistoryStackParamList, "History">,
  BottomTabNavigationProp<MainTabParamList>
>;

export default function HistoryScreen() {
  const navigation = useNavigation<HistoryScreenNavigationProp>();

  const handleScanPress = () => {
    // Navigate to ScanTab (different tab stack)
    navigation.navigate("ScanTab");
  };

  const handleItemPress = (itemId: number) => {
    // Navigate within current stack
    navigation.navigate("ItemDetail", { itemId });
  };
}
```

## Why

`CompositeNavigationProp` combines the stack navigator's type with the tab navigator's type, enabling type-safe navigation across both. Without it, calling `navigation.navigate("ScanTab")` raises a TypeScript error because `"ScanTab"` is not in the inner stack's param list.

## Exceptions

When to use:

- Dashboard with "Scan" CTA that navigates to camera tab
- Profile screen navigating to history or settings in other tabs
- Any cross-tab navigation from within a stack

For three-level reach (stack → tab → root modal), compose three navigators — see related patterns.

## Related Files

- `client/types/navigation.ts` — composite types per screen

## See Also

- [Intersection type for dual-stack screen registration](intersection-type-dual-stack-screen-registration-2026-05-13.md)
- [Align route params across dual-navigator screens](../conventions/align-route-params-dual-navigator-screens-2026-05-13.md)
- [Navigation param instead of callback for cross-screen communication](../conventions/navigation-param-instead-of-callback-2026-05-13.md)
