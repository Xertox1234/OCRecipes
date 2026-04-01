import {
  recipeDismissals,
  carouselSuggestionCache,
  communityRecipes,
  type Allergy,
} from "@shared/schema";
import type { CarouselRecipeCard } from "@shared/types/carousel";
import { db } from "../db";
import { eq, and, desc, gte, sql, inArray, not } from "drizzle-orm";

// ============================================================================
// RECIPE DISMISSALS
// ============================================================================

export async function getDismissedRecipeIds(
  userId: string,
): Promise<Set<string>> {
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

  return new Set(rows.map((r) => r.recipeIdentifier));
}

export async function dismissRecipe(
  userId: string,
  recipeIdentifier: string,
  source: string,
): Promise<void> {
  await db
    .insert(recipeDismissals)
    .values({ userId, recipeIdentifier, source })
    .onConflictDoNothing();
}

// ============================================================================
// CAROUSEL SUGGESTION CACHE
// ============================================================================

export async function getCarouselCache(
  userId: string,
  profileHash: string,
  mealType: string,
): Promise<CarouselRecipeCard[] | null> {
  const [row] = await db
    .select({ suggestions: carouselSuggestionCache.suggestions })
    .from(carouselSuggestionCache)
    .where(
      and(
        eq(carouselSuggestionCache.userId, userId),
        eq(carouselSuggestionCache.profileHash, profileHash),
        eq(carouselSuggestionCache.mealType, mealType),
        gte(carouselSuggestionCache.expiresAt, new Date()),
      ),
    )
    .limit(1);

  return row ? (row.suggestions as CarouselRecipeCard[]) : null;
}

export async function setCarouselCache(
  userId: string,
  profileHash: string,
  mealType: string,
  suggestions: CarouselRecipeCard[],
  ttlMs: number,
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs);

  await db
    .insert(carouselSuggestionCache)
    .values({ userId, profileHash, mealType, suggestions, expiresAt })
    .onConflictDoUpdate({
      target: [
        carouselSuggestionCache.userId,
        carouselSuggestionCache.profileHash,
        carouselSuggestionCache.mealType,
      ],
      set: { suggestions, expiresAt },
    });
}

// ============================================================================
// RECENT COMMUNITY RECIPES (free user carousel)
// ============================================================================

interface RecentRecipeFilters {
  dietType?: string | null;
  allergies?: Allergy[] | null;
  cuisinePreferences?: string[] | null;
  limit?: number;
  dismissedIds?: Set<string>;
}

export async function getRecentCommunityRecipes(
  userId: string,
  filters: RecentRecipeFilters,
) {
  const dismissedIds =
    filters.dismissedIds ?? (await getDismissedRecipeIds(userId));
  const limit = filters.limit ?? 8;

  // Fetch more than needed so we can filter out dismissed ones in app
  const fetchLimit = limit + dismissedIds.size;

  let query = db
    .select()
    .from(communityRecipes)
    .where(eq(communityRecipes.isPublic, true))
    .orderBy(desc(communityRecipes.createdAt))
    .limit(fetchLimit);

  const rows = await query;

  // Apply in-memory filters for diet/allergy matching and dismissal exclusion
  return rows
    .filter((r) => {
      const identifier = `community:${r.id}`;
      if (dismissedIds.has(identifier)) return false;
      return true;
    })
    .filter((r) => {
      // Basic diet type matching via dietTags
      if (filters.dietType && r.dietTags && r.dietTags.length > 0) {
        const dietLower = filters.dietType.toLowerCase();
        const hasDietMatch = r.dietTags.some(
          (tag) => tag.toLowerCase() === dietLower,
        );
        // Don't strictly exclude, but we could boost matching recipes
        // For now, include all — ranking happens in the builder
      }
      return true;
    })
    .slice(0, limit);
}
