import { db } from "../db";
import { eq, and, inArray, sql } from "drizzle-orm";
import {
  favouriteRecipes,
  mealPlanRecipes,
  communityRecipes,
  users,
  type ResolvedFavouriteRecipe,
} from "@shared/schema";
import { TIER_FEATURES, isValidSubscriptionTier } from "@shared/types/premium";
import { fireAndForget } from "../lib/fire-and-forget";

export async function toggleFavouriteRecipe(
  userId: string,
  recipeId: number,
  recipeType: "mealPlan" | "community",
): Promise<boolean | null> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: favouriteRecipes.id })
      .from(favouriteRecipes)
      .where(
        and(
          eq(favouriteRecipes.userId, userId),
          eq(favouriteRecipes.recipeId, recipeId),
          eq(favouriteRecipes.recipeType, recipeType),
        ),
      );

    if (existing) {
      await tx
        .delete(favouriteRecipes)
        .where(eq(favouriteRecipes.id, existing.id));
      return false;
    }

    const countResult = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(favouriteRecipes)
      .where(eq(favouriteRecipes.userId, userId));
    const count = countResult[0]?.count ?? 0;

    const [subRow] = await tx
      .select({ tier: users.subscriptionTier })
      .from(users)
      .where(eq(users.id, userId));
    const tierValue = subRow?.tier || "free";
    const tier = isValidSubscriptionTier(tierValue) ? tierValue : "free";
    const limit = TIER_FEATURES[tier].maxFavouriteRecipes;

    if (count >= limit) {
      return null;
    }

    try {
      await tx
        .insert(favouriteRecipes)
        .values({ userId, recipeId, recipeType });
      return true;
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        "code" in err &&
        err.code === "23505"
      ) {
        await tx
          .delete(favouriteRecipes)
          .where(
            and(
              eq(favouriteRecipes.userId, userId),
              eq(favouriteRecipes.recipeId, recipeId),
              eq(favouriteRecipes.recipeType, recipeType),
            ),
          );
        return false;
      }
      throw err;
    }
  });
}

export async function getUserFavouriteRecipeIds(
  userId: string,
): Promise<{ recipeId: number; recipeType: string }[]> {
  return db
    .select({
      recipeId: favouriteRecipes.recipeId,
      recipeType: favouriteRecipes.recipeType,
    })
    .from(favouriteRecipes)
    .where(eq(favouriteRecipes.userId, userId));
}

export async function isRecipeFavourited(
  userId: string,
  recipeId: number,
  recipeType: "mealPlan" | "community",
): Promise<boolean> {
  const [row] = await db
    .select({ id: favouriteRecipes.id })
    .from(favouriteRecipes)
    .where(
      and(
        eq(favouriteRecipes.userId, userId),
        eq(favouriteRecipes.recipeId, recipeId),
        eq(favouriteRecipes.recipeType, recipeType),
      ),
    );
  return !!row;
}

export async function getFavouriteRecipeCount(userId: string): Promise<number> {
  const result = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(favouriteRecipes)
    .where(eq(favouriteRecipes.userId, userId));
  return result[0]?.count ?? 0;
}

export async function getResolvedFavouriteRecipes(
  userId: string,
  limit = 50,
): Promise<ResolvedFavouriteRecipe[]> {
  const rows = await db
    .select()
    .from(favouriteRecipes)
    .where(eq(favouriteRecipes.userId, userId))
    .orderBy(sql`${favouriteRecipes.createdAt} DESC`)
    .limit(limit);

  if (rows.length === 0) return [];

  const mealPlanIds: number[] = [];
  const communityIds: number[] = [];
  for (const row of rows) {
    if (row.recipeType === "mealPlan") mealPlanIds.push(row.recipeId);
    else if (row.recipeType === "community") communityIds.push(row.recipeId);
  }

  const [mealPlanRows, communityRows] = await Promise.all([
    mealPlanIds.length
      ? db
          .select()
          .from(mealPlanRecipes)
          .where(inArray(mealPlanRecipes.id, mealPlanIds))
      : [],
    communityIds.length
      ? db
          .select()
          .from(communityRecipes)
          .where(inArray(communityRecipes.id, communityIds))
      : [],
  ]);

  const mealPlanMap = new Map(mealPlanRows.map((r) => [r.id, r]));
  const communityMap = new Map(communityRows.map((r) => [r.id, r]));

  const resolved: ResolvedFavouriteRecipe[] = [];
  const orphanIds: number[] = [];

  for (const row of rows) {
    if (row.recipeType === "mealPlan") {
      const recipe = mealPlanMap.get(row.recipeId);
      if (recipe) {
        resolved.push({
          recipeId: recipe.id,
          recipeType: "mealPlan",
          title: recipe.title,
          description: recipe.description ?? null,
          imageUrl: recipe.imageUrl ?? null,
          servings: recipe.servings ?? null,
          difficulty: recipe.difficulty ?? null,
          favouritedAt: row.createdAt.toISOString(),
        });
      } else orphanIds.push(row.id);
    } else if (row.recipeType === "community") {
      const recipe = communityMap.get(row.recipeId);
      if (recipe) {
        resolved.push({
          recipeId: recipe.id,
          recipeType: "community",
          title: recipe.title,
          description: recipe.description ?? null,
          imageUrl: recipe.imageUrl ?? null,
          servings: recipe.servings ?? null,
          difficulty: recipe.difficulty ?? null,
          favouritedAt: row.createdAt.toISOString(),
        });
      } else orphanIds.push(row.id);
    }
  }

  if (orphanIds.length) {
    fireAndForget(
      "favourite-recipe-orphan-cleanup",
      db
        .delete(favouriteRecipes)
        .where(inArray(favouriteRecipes.id, orphanIds)),
    );
  }

  return resolved;
}

/** Fetch recipe data for sharing. Returns null if not found or not accessible. */
export async function getRecipeSharePayload(
  recipeId: number,
  recipeType: "mealPlan" | "community",
  userId: string,
): Promise<{
  title: string;
  description: string;
  imageUrl: string | null;
} | null> {
  if (recipeType === "community") {
    const [recipe] = await db
      .select({
        title: communityRecipes.title,
        description: communityRecipes.description,
        imageUrl: communityRecipes.imageUrl,
      })
      .from(communityRecipes)
      .where(eq(communityRecipes.id, recipeId));
    if (!recipe) return null;
    return {
      title: recipe.title,
      description: recipe.description ?? "",
      imageUrl: recipe.imageUrl ?? null,
    };
  } else {
    // mealPlan recipes are personal — verify ownership
    const [recipe] = await db
      .select({
        title: mealPlanRecipes.title,
        description: mealPlanRecipes.description,
        imageUrl: mealPlanRecipes.imageUrl,
      })
      .from(mealPlanRecipes)
      .where(
        and(
          eq(mealPlanRecipes.id, recipeId),
          eq(mealPlanRecipes.userId, userId),
        ),
      );
    if (!recipe) return null;
    return {
      title: recipe.title,
      description: recipe.description ?? "",
      imageUrl: recipe.imageUrl ?? null,
    };
  }
}
