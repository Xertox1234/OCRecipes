import { db } from "../db";
import { eq, sql } from "drizzle-orm";
import {
  cookbooks,
  savedItems,
  scannedItems,
  groceryLists,
  pantryItems,
  communityRecipes,
} from "@shared/schema";
import type { LibraryCountsResponse } from "@shared/schemas/profile-hub";

/**
 * Fetch all library section counts for a user in a single SQL query.
 * Uses subselects to avoid 6 separate round trips.
 */
export async function getLibraryCounts(
  userId: string,
): Promise<LibraryCountsResponse> {
  const result = await db
    .select({
      cookbooks: sql<number>`(SELECT count(*) FROM cookbooks WHERE user_id = ${userId})`,
      savedItems: sql<number>`(SELECT count(*) FROM saved_items WHERE user_id = ${userId})`,
      scanHistory: sql<number>`(SELECT count(*) FROM scanned_items WHERE user_id = ${userId})`,
      groceryLists: sql<number>`(SELECT count(*) FROM grocery_lists WHERE user_id = ${userId})`,
      pantryItems: sql<number>`(SELECT count(*) FROM pantry_items WHERE user_id = ${userId})`,
      featuredRecipes: sql<number>`(SELECT count(*) FROM community_recipes WHERE is_public = true)`,
    })
    .from(sql`(SELECT 1) AS _dummy`);

  const row = result[0];
  return {
    cookbooks: Number(row?.cookbooks ?? 0),
    savedItems: Number(row?.savedItems ?? 0),
    scanHistory: Number(row?.scanHistory ?? 0),
    groceryLists: Number(row?.groceryLists ?? 0),
    pantryItems: Number(row?.pantryItems ?? 0),
    featuredRecipes: Number(row?.featuredRecipes ?? 0),
  };
}
