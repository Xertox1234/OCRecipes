import { storage } from "../storage";
import { AI_DAILY_CAPS, TIER_FEATURES } from "@shared/types/premium";
import { generateRecipeImage } from "./recipe-generation";

/**
 * Generate a hero image for a recipe saved without one. Run it through
 * `fireAndForget` — the save has already succeeded, so every refusal here
 * just leaves the placeholder.
 *
 * Gated on the effective tier's `recipeAutoImages` (free users get no image
 * call), then bounded by the DB-backed daily cap shared by every auto-image
 * path, claimed BEFORE the paid call.
 */
export async function autoGenerateRecipeImage(
  recipe: {
    id: number;
    title: string;
    cuisine: string | null;
    mealTypes: string[] | null;
  },
  userId: string,
): Promise<void> {
  const tier = await storage.getEffectiveTierForUser(userId);
  if (!TIER_FEATURES[tier].recipeAutoImages) return;
  const claimed = await storage.claimDailyAiCall(
    userId,
    "recipeAutoImage",
    AI_DAILY_CAPS.recipeAutoImage,
  );
  if (!claimed) return;
  const imageUrl = await generateRecipeImage({
    title: recipe.title,
    cuisine: recipe.cuisine,
    mealTypes: recipe.mealTypes,
  });
  if (imageUrl) {
    await storage.updateMealPlanRecipe(recipe.id, userId, { imageUrl });
  }
}
