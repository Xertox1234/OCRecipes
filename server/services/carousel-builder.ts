import type { UserProfile, CommunityRecipe } from "@shared/schema";
import type { CarouselRecipeCard } from "@shared/types/carousel";
import { storage } from "../storage";
import { inferMealTimeHint } from "../lib/meal-time-hint";

type CarouselRecipe = Pick<
  CommunityRecipe,
  | "id"
  | "title"
  | "imageUrl"
  | "timeEstimate"
  | "remixedFromId"
  | "dietTags"
  | "isCanonical"
  | "mealTypes"
>;

// ── Normalization ────────────────────────────────────────────────────

function normalizeCommunity(
  recipe: CarouselRecipe,
  profile: UserProfile | null,
): CarouselRecipeCard {
  return {
    id: recipe.id,
    title: recipe.title,
    imageUrl: recipe.imageUrl,
    prepTimeMinutes: parseTimeEstimate(recipe.timeEstimate),
    recommendationReason: generateCommunityReason(recipe, profile),
    isRemix: !!recipe.remixedFromId,
    isCanonical: recipe.isCanonical,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function parseTimeEstimate(timeEstimate: string | null): number | null {
  if (!timeEstimate) return null;
  const match = timeEstimate.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

function generateCommunityReason(
  recipe: CarouselRecipe,
  profile: UserProfile | null,
): string {
  if (!profile) return "Recently added recipe";

  const tags = recipe.dietTags ?? [];
  if (
    profile.dietType &&
    tags.some((t) => t.toLowerCase() === profile.dietType!.toLowerCase())
  ) {
    return `Matches your ${profile.dietType} diet`;
  }

  if (
    profile.cuisinePreferences &&
    profile.cuisinePreferences.length > 0 &&
    tags.some((t) =>
      profile.cuisinePreferences!.some(
        (c) => c.toLowerCase() === t.toLowerCase(),
      ),
    )
  ) {
    return "Matches your cuisine preferences";
  }

  const prepMins = parseTimeEstimate(recipe.timeEstimate);
  if (prepMins && prepMins <= 30) {
    return "Quick and easy — under 30 minutes";
  }

  return "Recently added recipe";
}

// ── Main builder ─────────────────────────────────────────────────────

export async function buildCarousel(
  userId: string,
  userProfile: UserProfile | null,
): Promise<CarouselRecipeCard[]> {
  const dismissedIds = await storage.getDismissedRecipeIds(userId);

  const recipes = await storage.getRecentCommunityRecipes(userId, {
    dietType: userProfile?.dietType,
    allergies: userProfile?.allergies,
    cuisinePreferences: userProfile?.cuisinePreferences,
    limit: 8,
    dismissedIds,
  });

  // getRecentCommunityRecipes already excludes dismissed IDs at the DB level
  // (notInArray clause). No post-DB filter needed here.

  // NOTE: When carousel caching is added, the cache key MUST include the hour bucket.
  const hint = inferMealTimeHint(new Date().getHours());
  const sorted = [...recipes].sort((a, b) => {
    const aMatches = (a.mealTypes ?? []).includes(hint) ? 0 : 1;
    const bMatches = (b.mealTypes ?? []).includes(hint) ? 0 : 1;
    return aMatches - bMatches;
  });
  return sorted.map((r) => normalizeCommunity(r, userProfile)).slice(0, 8);
}
