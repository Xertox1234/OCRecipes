import {
  recipeDismissals,
  communityRecipes,
  type Allergy,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, desc, gte, notInArray, isNotNull } from "drizzle-orm";

/**
 * Display columns needed for the recipe carousel.
 * Excludes the heavy `instructions` JSONB column — carousel cards never show step-by-step instructions.
 */
const CAROUSEL_COLUMNS = {
  id: communityRecipes.id,
  title: communityRecipes.title,
  imageUrl: communityRecipes.imageUrl,
  timeEstimate: communityRecipes.timeEstimate,
  remixedFromId: communityRecipes.remixedFromId,
  dietTags: communityRecipes.dietTags,
} as const;

// ============================================================================
// RECIPE DISMISSALS
// ============================================================================

export async function getDismissedRecipeIds(
  userId: string,
): Promise<Set<number>> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ recipeIdentifier: recipeDismissals.recipeIdentifier })
    .from(recipeDismissals)
    .where(
      and(
        eq(recipeDismissals.userId, userId),
        gte(recipeDismissals.dismissedAt, ninetyDaysAgo),
      ),
    )
    .limit(500);

  const ids = new Set<number>();
  for (const r of rows) {
    const num = parseInt(r.recipeIdentifier, 10);
    if (!Number.isNaN(num)) ids.add(num);
  }
  return ids;
}

export async function dismissRecipe(
  userId: string,
  recipeId: number,
): Promise<void> {
  await db
    .insert(recipeDismissals)
    .values({
      userId,
      recipeIdentifier: String(recipeId),
      source: "community",
    })
    .onConflictDoNothing();
}

// ============================================================================
// RECENT COMMUNITY RECIPES
// ============================================================================

interface RecentRecipeFilters {
  dietType?: string | null;
  allergies?: Allergy[] | null;
  cuisinePreferences?: string[] | null;
  limit?: number;
  dismissedIds?: Set<number>;
}

export async function getRecentCommunityRecipes(
  userId: string,
  filters: RecentRecipeFilters,
) {
  const dismissedIds =
    filters.dismissedIds ?? (await getDismissedRecipeIds(userId));
  const limit = filters.limit ?? 8;

  const dismissedNumericIds = [...dismissedIds];

  const conditions = [
    eq(communityRecipes.isPublic, true),
    isNotNull(communityRecipes.imageUrl),
  ];
  if (dismissedNumericIds.length > 0) {
    conditions.push(notInArray(communityRecipes.id, dismissedNumericIds));
  }

  return db
    .select(CAROUSEL_COLUMNS)
    .from(communityRecipes)
    .where(and(...conditions))
    .orderBy(desc(communityRecipes.createdAt))
    .limit(limit);
}
