import { db } from "../db";
import { sql } from "drizzle-orm";
import type { LibraryCountsResponse } from "@shared/schemas/profile-hub";

/** In-memory cache for the global featured recipes count (same for all users). */
let featuredRecipesCache: { count: number; expiresAt: number } | null = null;
const FEATURED_CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Fetch all library section counts for a user in a single SQL query.
 * Uses subselects to avoid 6 separate round trips.
 * The global featuredRecipes count is cached in-memory for 5 minutes.
 */
export async function getLibraryCounts(
  userId: string,
): Promise<LibraryCountsResponse> {
  const now = Date.now();
  const useCachedFeatured =
    featuredRecipesCache !== null && featuredRecipesCache.expiresAt > now;

  if (useCachedFeatured) {
    const result = await db
      .select({
        cookbooks: sql<number>`(SELECT count(*) FROM cookbooks WHERE user_id = ${userId})`,
        savedItems: sql<number>`(SELECT count(*) FROM saved_items WHERE user_id = ${userId})`,
        scanHistory: sql<number>`(SELECT count(*) FROM scanned_items WHERE user_id = ${userId} AND discarded_at IS NULL)`,
        groceryLists: sql<number>`(SELECT count(*) FROM grocery_lists WHERE user_id = ${userId})`,
        pantryItems: sql<number>`(SELECT count(*) FROM pantry_items WHERE user_id = ${userId})`,
        favouriteRecipes: sql<number>`(SELECT count(*) FROM favourite_recipes WHERE user_id = ${userId})`,
      })
      .from(sql`(SELECT 1) AS _dummy`);

    const row = result[0];
    return {
      cookbooks: Number(row?.cookbooks ?? 0),
      savedItems: Number(row?.savedItems ?? 0),
      scanHistory: Number(row?.scanHistory ?? 0),
      groceryLists: Number(row?.groceryLists ?? 0),
      pantryItems: Number(row?.pantryItems ?? 0),
      featuredRecipes: featuredRecipesCache!.count,
      favouriteRecipes: Number(row?.favouriteRecipes ?? 0),
    };
  }

  const result = await db
    .select({
      cookbooks: sql<number>`(SELECT count(*) FROM cookbooks WHERE user_id = ${userId})`,
      savedItems: sql<number>`(SELECT count(*) FROM saved_items WHERE user_id = ${userId})`,
      scanHistory: sql<number>`(SELECT count(*) FROM scanned_items WHERE user_id = ${userId} AND discarded_at IS NULL)`,
      groceryLists: sql<number>`(SELECT count(*) FROM grocery_lists WHERE user_id = ${userId})`,
      pantryItems: sql<number>`(SELECT count(*) FROM pantry_items WHERE user_id = ${userId})`,
      featuredRecipes: sql<number>`(SELECT count(*) FROM community_recipes WHERE is_public = true)`,
      favouriteRecipes: sql<number>`(SELECT count(*) FROM favourite_recipes WHERE user_id = ${userId})`,
    })
    .from(sql`(SELECT 1) AS _dummy`);

  const row = result[0];
  const featuredCount = Number(row?.featuredRecipes ?? 0);
  featuredRecipesCache = {
    count: featuredCount,
    expiresAt: now + FEATURED_CACHE_TTL_MS,
  };

  return {
    cookbooks: Number(row?.cookbooks ?? 0),
    savedItems: Number(row?.savedItems ?? 0),
    scanHistory: Number(row?.scanHistory ?? 0),
    groceryLists: Number(row?.groceryLists ?? 0),
    pantryItems: Number(row?.pantryItems ?? 0),
    featuredRecipes: featuredCount,
    favouriteRecipes: Number(row?.favouriteRecipes ?? 0),
  };
}
