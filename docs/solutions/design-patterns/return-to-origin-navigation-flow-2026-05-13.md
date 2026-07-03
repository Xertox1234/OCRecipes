---
title: Return-to-origin navigation flow via returnTo param + popToTop()
track: knowledge
category: design-patterns
module: client
tags: [react-native, navigation, params, flow, popToTop]
applies_to: [client/screens/**/*.tsx, client/components/**/*.tsx]
created: '2026-05-13'
---

# Return-to-origin navigation flow via returnTo param + popToTop()

## When this applies

When a creation/import flow is triggered from an inline context (e.g., a bottom sheet), pass a `returnTo` param so the destination screen can auto-add the result and `popToTop()` back to the origin.

## Examples

```tsx
// 1. Define the param in the navigator
type MealPlanStackParamList = {
  RecipeCreate: {
    returnToMealPlan?: { mealType: string; plannedDate: string };
  };
};

// 2. Pass it from the trigger (QuickAddSheet footer)
onNavigateCreate(mealType, plannedDate);
// → navigation.navigate("RecipeCreate", {
//     returnToMealPlan: { mealType, plannedDate },
//   });

// 3. Consume in the destination screen
const returnToMealPlan = route.params?.returnToMealPlan;

const handleSave = async () => {
  const newRecipe = await createMutation.mutateAsync(payload);
  if (returnToMealPlan) {
    await addItemMutation.mutateAsync({
      recipeId: newRecipe.id,
      mealType: returnToMealPlan.mealType,
      plannedDate: returnToMealPlan.plannedDate,
    });
    navigation.popToTop(); // Back to origin
  } else {
    navigation.goBack(); // Normal flow
  }
};
```

## Why

**Key elements:**

- Optional `returnTo` route param with the data needed to complete the action
- Destination screen auto-performs the follow-up action (add to plan) on success
- `popToTop()` instead of `goBack()` to clear the entire sub-stack
- Both paths share the same save logic — only post-save behavior differs

## Exceptions

When to use: any flow where a screen can be reached from multiple contexts and should return differently based on origin (inline add vs standalone browse).

## Related Files

- `client/screens/meal-plan/RecipeCreateScreen.tsx` — auto-add + `popToTop` when `returnToMealPlan` set
- `client/screens/meal-plan/RecipeImportScreen.tsx` — same pattern
- `client/components/meal-plan/QuickAddSheet.tsx` — passes `returnToMealPlan` via footer buttons

## See Also

- [Inline quick-add bottom sheet](inline-quick-add-bottom-sheet-2026-05-13.md)
- [Navigation param instead of callback for cross-screen communication](../conventions/navigation-param-instead-of-callback-2026-05-13.md)
