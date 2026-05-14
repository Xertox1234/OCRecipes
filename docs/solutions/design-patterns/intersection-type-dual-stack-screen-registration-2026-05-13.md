---
title: "Intersection type for dual-stack screen registration"
track: knowledge
category: design-patterns
tags: [react-native, navigation, typescript, intersection-types]
module: client
applies_to: ["client/types/navigation.ts"]
created: 2026-05-13
---

# Intersection type for dual-stack screen registration

## When this applies

When a screen is registered in **two different stack navigators** (e.g., `FavouriteRecipesScreen` in both `MealPlanStackNavigator` and `ProfileStackNavigator`), use an intersection type for the inner `NativeStackNavigationProp`.

## Examples

```typescript
// Screen registered in both MealPlanStack and ProfileStack
type FavouriteRecipesScreenNavigationProp = CompositeNavigationProp<
  NativeStackNavigationProp<
    MealPlanStackParamList & ProfileStackParamList, // Intersection of both stacks
    "FavouriteRecipes"
  >,
  CompositeNavigationProp<
    BottomTabNavigationProp<MainTabParamList>,
    NativeStackNavigationProp<RootStackParamList>
  >
>;
```

## Why

Intersection (`A & B`), not union: it tells TypeScript "this screen can navigate to routes from _both_ stacks." React Navigation resolves navigation calls through the composite prop chain regardless of which stack is active, so the intersection is truthful.

## Exceptions

When to use: A screen registered in multiple stack navigators that needs to navigate to routes from either hosting stack.

## Related Files

- `client/types/navigation.ts` — `FavouriteRecipesScreenNavigationProp`

## See Also

- [CompositeNavigationProp for cross-stack navigation](composite-navigation-prop-cross-stack-2026-05-13.md)
- [Align route params across dual-navigator screens](../conventions/align-route-params-dual-navigator-screens-2026-05-13.md)
