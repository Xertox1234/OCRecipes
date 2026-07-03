---
title: Unified modal with type discriminator param
track: knowledge
category: design-patterns
module: client
tags: [react-native, navigation, modal, discriminator, normalization, tanstack-query]
applies_to: [client/screens/**/*.tsx, client/navigation/RootStackNavigator.tsx]
created: '2026-05-13'
---

# Unified modal with type discriminator param

## When this applies

When the same content is displayed from multiple entry points across different navigators, register **one root-level modal** with a type discriminator param instead of maintaining separate screens per navigator. The single screen uses mutually exclusive `useQuery` hooks and a normalization layer to handle different data sources.

## Examples

```typescript
// RootStackParamList — discriminator param with default
FeaturedRecipeDetail: {
  recipeId: number;
  recipeType?: "community" | "mealPlan";  // defaults to "community"
};
```

```typescript
// Single screen with dual-fetch + normalization
export default function FeaturedRecipeDetailScreen() {
  const { recipeId, recipeType = "community" } = route.params;

  // Only one query fires — mutually exclusive `enabled` flags
  const { data: community, isLoading: communityLoading } = useQuery({
    queryKey: [`/api/recipes/${recipeId}`],
    enabled: recipeType === "community",
  });
  const { data: mealPlan, isLoading: mealPlanLoading } = useQuery({
    queryKey: ["/api/meal-plan/recipes", recipeId],
    enabled: recipeType === "mealPlan",
  });

  // Normalize all sources into shared props interface
  const normalized = useMemo((): NormalizedRecipe | null => {
    if (recipeType === "mealPlan" && mealPlan) return normalizeMealPlan(mealPlan);
    if (community) return normalizeCommunity(community);
    return null;
  }, [recipeType, mealPlan, community]);

  // Check only the active query
  const isLoading =
    recipeType === "community" ? communityLoading : mealPlanLoading;

  return (
    <View accessibilityViewIsModal>
      <DragHandle />
      <RecipeDetailContent {...normalized} />
    </View>
  );
}
```

**Reference implementation:** `FeaturedRecipeDetailScreen` — single root modal for all recipe detail views across home carousel, recipe browser, meal plan, cookbooks, and profile.

## Why

**Key principles:**

- **Discriminator param with default**: `recipeType` defaults to `"community"` so deep links and existing callers work without changes.
- **Mutually exclusive queries**: Two `useQuery` hooks with opposite `enabled` flags — only the active source fetches. Check `isLoading`/`error` on the active query only, not with OR.
- **Always fetch from API**: The detail screen always fetches the full recipe from the server, ensuring complete data (ingredients, instructions, etc.) is available regardless of the entry point.
- **Normalization in `useMemo`**: A typed interface (e.g., `NormalizedRecipe`) unifies different API shapes. Each source gets its own normalizer function.
- **Shared content component**: The layout lives in a separate `*Content` component (`RecipeDetailContent`) that accepts the normalized interface. The screen handles chrome (drag handle, safe areas), the content component handles layout.
- **Hide missing sections**: Use conditional rendering (`{data && <Section />}`), not placeholders. Different data sources have different fields available.

## Exceptions

When to use: the same content is shown from 3+ entry points across different navigators and you want uniform UX (same presentation, same dismissal, same chrome).

When NOT to use: when screens have genuinely different chrome requirements (e.g., one needs a toolbar with actions, another is read-only). In that case, share a `*Content` component but keep separate screen wrappers.

## See Also

- [Full-screen detail with transparentModal](full-screen-detail-transparent-modal-2026-05-13.md)
- [Drag handle for gesture-dismissible modals](drag-handle-gesture-dismissible-modals-2026-05-13.md)
- [Deep link query param aliases](deep-link-query-param-aliases-2026-05-13.md)
- [Unified create/edit screen via optional param](unified-create-edit-screen-optional-param-2026-05-13.md)
