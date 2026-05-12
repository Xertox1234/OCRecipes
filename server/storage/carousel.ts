import {
  recipeDismissals,
  communityRecipes,
  type Allergy,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, desc, gte, notInArray, isNotNull, sql } from "drizzle-orm";

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
  isCanonical: communityRecipes.isCanonical,
  mealTypes: communityRecipes.mealTypes,
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

/**
 * Return an ordered list of recently dismissed recipe IDs for a user,
 * newest first, limited to the last 25 dismissals within the past 90 days.
 *
 * Unlike getDismissedRecipeIds (unordered Set, up to 500 items — used by the
 * carousel to filter results), this function returns an ordered number[] limited
 * to 25 items — the correct shape for injecting into an AI prompt.
 */
export async function getRecentDismissedRecipeIds(
  userId: string,
  limit = 25,
): Promise<number[]> {
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
    .orderBy(desc(recipeDismissals.dismissedAt))
    .limit(limit);
  const ids: number[] = [];
  for (const r of rows) {
    const num = parseInt(r.recipeIdentifier, 10);
    if (!Number.isNaN(num)) ids.push(num);
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

  // Boost (don't filter) recipes whose dietTags overlap with the user's
  // cuisinePreferences so "Matches your cuisine preferences" labels surface
  // when the user has a taste profile, while still returning a full carousel
  // when no recent recipes match. Compare lowercase on both sides because
  // setTastePicks may store either original-case cuisineOrigin or lowercased
  // dietTag values.
  const cuisinePrefs = (filters.cuisinePreferences ?? [])
    .map((c) => c.toLowerCase())
    .filter((c) => c.length > 0);
  const orderClauses =
    cuisinePrefs.length > 0
      ? [
          // 0 when any lowercased dietTag is in the user's prefs, else 1.
          // Boost ordering — recipes with matching cuisine float to the top
          // while non-matching recipes still appear after.
          sql`CASE WHEN EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(${communityRecipes.dietTags}) AS tag
            WHERE LOWER(tag) IN (${sql.join(
              cuisinePrefs.map((c) => sql`${c}`),
              sql`, `,
            )})
          ) THEN 0 ELSE 1 END`,
          desc(communityRecipes.createdAt),
        ]
      : [desc(communityRecipes.createdAt)];

  return db
    .select(CAROUSEL_COLUMNS)
    .from(communityRecipes)
    .where(and(...conditions))
    .orderBy(...orderClauses)
    .limit(limit);
}
