import type { QueryClient } from "@tanstack/react-query";

import {
  setHeldRecipeDraft,
  type HeldRecipeDraft,
} from "@/hooks/useGeneratedRecipeNotices";
import { navigationRef } from "@/navigation/navigationRef";

/**
 * Open the recipe editor prefilled with a held meal-plan draft, from anywhere.
 * `RecipeCreate` is NESTED (Main → MealPlanTab → RecipeCreate), so the route
 * is spelled out with `pop: true` at both levels, exactly like
 * `openCoachConversation` in MainTabNavigator. The held draft is released only once the
 * navigation actually went out — a tap before the container is ready keeps
 * it for the banner on the generate screen.
 */
export function openRecipeCreate(
  queryClient: QueryClient,
  draft: HeldRecipeDraft,
): void {
  if (!navigationRef.isReady()) return;
  navigationRef.navigate(
    "Main",
    {
      screen: "MealPlanTab",
      params: {
        screen: "RecipeCreate",
        params: {
          prefill: draft.prefill,
          returnToMealPlan: draft.returnToMealPlan,
        },
        pop: true,
      },
    },
    { pop: true },
  );
  setHeldRecipeDraft(queryClient, null);
}

// Its own module (not MainTabNavigator) so RecipeAIGenerateScreen — which
// lives inside the MealPlan stack that MainTabNavigator renders — can import
// it without an import cycle.
