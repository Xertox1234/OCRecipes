import { isAiSharingAllowedFor } from "../lib/ai-sharing-gate";
import { dishImageKey } from "../lib/dish-image-key";
import { createServiceLogger, toError } from "../lib/logger";
import { storage } from "../storage";
import { AI_DAILY_CAPS, TIER_FEATURES } from "@shared/types/premium";
import { generateRecipeImage } from "./recipe-generation";

const logger = createServiceLogger("recipe-auto-image");

/**
 * The shared picture for a quick entry's dish name, looked up before the
 * recipe is created. `key` is set only when this entry takes part in sharing:
 * a `quick_entry` with no picture of its own and a name that leaves something
 * to key on. A picture the person supplied is never looked up or recorded.
 * `url` is the stored picture, or `null` when nobody has one yet. A failed
 * lookup reads as "none yet" — the create must not fail over a picture.
 */
export async function sharedDishImage(
  sourceType: string | null | undefined,
  title: string,
  suppliedImageUrl: string | null | undefined,
): Promise<{ key: string | null; url: string | null }> {
  if (sourceType !== "quick_entry" || suppliedImageUrl) {
    return { key: null, url: null };
  }
  const key = dishImageKey(title);
  if (!key) return { key: null, url: null };
  try {
    return { key, url: (await storage.getDishImageUrl(key)) ?? null };
  } catch (err) {
    logger.warn({ err: toError(err) }, "shared dish picture lookup failed");
    return { key, url: null };
  }
}

/**
 * Generate a hero image for a recipe saved without one. Run it through
 * `fireAndForget` — the save has already succeeded, so every refusal here
 * just leaves the placeholder.
 *
 * Gated on the effective tier's `recipeAutoImages` (free users get no image
 * call), then bounded by the DB-backed daily cap shared by every auto-image
 * path, claimed BEFORE the paid call.
 *
 * `shareKey` (from `sharedDishImage`) records the new picture as the shared
 * one for that dish name, so later quick entries reuse it.
 */
export async function autoGenerateRecipeImage(
  recipe: {
    id: number;
    title: string;
    cuisine: string | null;
    mealTypes: string[] | null;
  },
  userId: string,
  shareKey?: string | null,
): Promise<void> {
  const tier = await storage.getEffectiveTierForUser(userId);
  if (!TIER_FEATURES[tier].recipeAutoImages) return;
  // Privacy audit H3: with AI features off, a saved recipe's title and
  // ingredients do not go to the image company either.
  if (!(await isAiSharingAllowedFor(userId))) return;
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
    if (shareKey) await storage.recordDishImage(shareKey, imageUrl);
  }
}
