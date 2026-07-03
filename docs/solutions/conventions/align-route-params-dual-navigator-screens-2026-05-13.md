---
title: Align route params across dual-navigator screens
track: knowledge
category: conventions
module: client
tags: [react-native, navigation, typescript, route-params, dual-navigator]
applies_to: [client/navigation/**/*.ts, client/navigation/**/*.tsx]
created: '2026-05-13'
---

# Align route params across dual-navigator screens

## Rule

When a screen component is mounted in **two different navigators** with separate param lists (e.g., `RecipeBrowserScreen` as both `RecipeBrowser` in `MealPlanStack` and `RecipeBrowserModal` in `RootStack`), keep the shared param fields synchronized across both `ParamList` types. This complements the intersection-type pattern for the navigation prop — this one covers the **route params**.

## Examples

```typescript
// Both navigators define planDays — screen reads it without casting
export type MealPlanStackParamList = {
  RecipeBrowser: {
    mealType?: string;
    plannedDate?: string;
    planDays?: MealPlanDay[]; // also in RootStackParamList
  };
};

export type RootStackParamList = {
  RecipeBrowserModal:
    | { mealType?: string; date?: string; planDays?: MealPlanDay[] }
    | undefined;
};

// In the screen — no cast needed
const { mealType, plannedDate, searchQuery, planDays } = route.params || {};
```

```typescript
// Bad: Using `as` cast because the route type doesn't include planDays
const planDays = (route.params as { planDays?: MealPlanDay[] } | undefined)
  ?.planDays;
```

## Why

React Navigation merges params at runtime regardless of TypeScript types. An `as` cast makes it _work_ but defeats the compiler — if someone renames `planDays` in one ParamList but not the other, no type error fires. Aligned types make the compiler your safety net.

## Exceptions

When to use: a screen registered in two navigators that receives the same data field from both entry points.

## Related Files

- `client/navigation/MealPlanStackNavigator.tsx` — `MealPlanStackParamList["RecipeBrowser"]`
- `client/navigation/RootStackNavigator.tsx` — `RootStackParamList["RecipeBrowserModal"]`
- `client/screens/meal-plan/RecipeBrowserScreen.tsx` — reads `planDays` without cast

## See Also

- [Intersection type for dual-stack screen registration](../design-patterns/intersection-type-dual-stack-screen-registration-2026-05-13.md)
