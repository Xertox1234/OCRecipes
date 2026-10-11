import { db } from "../db";
import { and, count, desc, eq } from "drizzle-orm";
import {
  communityRecipes,
  favouriteRecipes,
  recipeTries,
} from "@shared/schema";
import type { RecipeCommunityStats } from "@shared/types/recipe-community";

/** True only for an existing community recipe with isPublic = true (NULL = private). */
export async function isPublicCommunityRecipe(
  recipeId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: communityRecipes.id })
    .from(communityRecipes)
    .where(
      and(
        eq(communityRecipes.id, recipeId),
        eq(communityRecipes.isPublic, true),
      ),
    )
    .limit(1);
  return row !== undefined;
}

/** Idempotent: true inserts (duplicate is a no-op), false deletes. */
export async function setRecipeTried(
  userId: string,
  recipeId: number,
  tried: boolean,
): Promise<void> {
  if (tried) {
    await db
      .insert(recipeTries)
      .values({ userId, recipeId })
      .onConflictDoNothing();
    return;
  }
  await db
    .delete(recipeTries)
    .where(
      and(eq(recipeTries.userId, userId), eq(recipeTries.recipeId, recipeId)),
    );
}

/** Counts computed from rows on read. Caller must gate on isPublicCommunityRecipe. */
export async function getRecipeCommunityStats(
  recipeId: number,
  userId: string,
): Promise<RecipeCommunityStats> {
  const [[tried], mine, [favourited], [variants]] = await Promise.all([
    db
      .select({ n: count() })
      .from(recipeTries)
      .where(eq(recipeTries.recipeId, recipeId)),
    db
      .select({ id: recipeTries.id })
      .from(recipeTries)
      .where(
        and(
          eq(recipeTries.recipeId, recipeId),
          eq(recipeTries.userId, userId),
        ),
      )
      .limit(1),
    db
      .select({ n: count() })
      .from(favouriteRecipes)
      .where(
        and(
          eq(favouriteRecipes.recipeId, recipeId),
          eq(favouriteRecipes.recipeType, "community"),
        ),
      ),
    db
      .select({ n: count() })
      .from(communityRecipes)
      .where(
        and(
          eq(communityRecipes.remixedFromId, recipeId),
          eq(communityRecipes.isPublic, true),
        ),
      ),
  ]);
  return {
    triedCount: tried?.n ?? 0,
    triedByMe: mine.length > 0,
    favouritedCount: favourited?.n ?? 0,
    variantCount: variants?.n ?? 0,
  };
}

/** Public remixes of a recipe, newest first. Never includes the author. */
export async function getRecipeVariants(
  recipeId: number,
  limit = 50,
): Promise<
  { id: number; title: string; imageUrl: string | null; createdAt: Date }[]
> {
  return db
    .select({
      id: communityRecipes.id,
      title: communityRecipes.title,
      imageUrl: communityRecipes.imageUrl,
      createdAt: communityRecipes.createdAt,
    })
    .from(communityRecipes)
    .where(
      and(
        eq(communityRecipes.remixedFromId, recipeId),
        eq(communityRecipes.isPublic, true),
      ),
    )
    .orderBy(desc(communityRecipes.createdAt), desc(communityRecipes.id))
    .limit(limit);
}
