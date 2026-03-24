import {
  type Cookbook,
  type InsertCookbook,
  type CookbookRecipe,
  type CookbookWithCount,
  type ResolvedCookbookRecipe,
  cookbooks,
  cookbookRecipes,
  mealPlanRecipes,
  communityRecipes,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, desc, sql, inArray, count } from "drizzle-orm";

// ============================================================================
// COOKBOOKS
// ============================================================================

export async function createCookbook(data: InsertCookbook): Promise<Cookbook> {
  const [created] = await db.insert(cookbooks).values(data).returning();
  return created;
}

export async function getUserCookbooks(
  userId: string,
  limit = 50,
): Promise<CookbookWithCount[]> {
  const rows = await db
    .select({
      id: cookbooks.id,
      userId: cookbooks.userId,
      name: cookbooks.name,
      description: cookbooks.description,
      coverImageUrl: cookbooks.coverImageUrl,
      createdAt: cookbooks.createdAt,
      updatedAt: cookbooks.updatedAt,
      recipeCount: count(cookbookRecipes.id),
    })
    .from(cookbooks)
    .leftJoin(cookbookRecipes, eq(cookbookRecipes.cookbookId, cookbooks.id))
    .where(eq(cookbooks.userId, userId))
    .groupBy(cookbooks.id)
    .orderBy(desc(cookbooks.updatedAt))
    .limit(limit);
  return rows.map((r) => ({ ...r, recipeCount: Number(r.recipeCount) }));
}

export async function getCookbook(
  id: number,
  userId: string,
): Promise<Cookbook | undefined> {
  const [cookbook] = await db
    .select()
    .from(cookbooks)
    .where(and(eq(cookbooks.id, id), eq(cookbooks.userId, userId)));
  return cookbook || undefined;
}

export async function updateCookbook(
  id: number,
  userId: string,
  data: Partial<Pick<Cookbook, "name" | "description" | "coverImageUrl">>,
): Promise<Cookbook | undefined> {
  const [updated] = await db
    .update(cookbooks)
    .set({ ...data, updatedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(cookbooks.id, id), eq(cookbooks.userId, userId)))
    .returning();
  return updated || undefined;
}

export async function deleteCookbook(
  id: number,
  userId: string,
): Promise<boolean> {
  const result = await db
    .delete(cookbooks)
    .where(and(eq(cookbooks.id, id), eq(cookbooks.userId, userId)))
    .returning({ id: cookbooks.id });
  return result.length > 0;
}

// ============================================================================
// COOKBOOK RECIPES (junction table)
// ============================================================================

export async function addRecipeToCookbook(
  cookbookId: number,
  recipeId: number,
  recipeType: "mealPlan" | "community",
): Promise<CookbookRecipe | undefined> {
  const [added] = await db
    .insert(cookbookRecipes)
    .values({ cookbookId, recipeId, recipeType })
    .onConflictDoNothing()
    .returning();

  // Only bump updatedAt if the insert actually succeeded (not a duplicate)
  if (added) {
    await db
      .update(cookbooks)
      .set({ updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(cookbooks.id, cookbookId));
  }

  return added || undefined;
}

export async function removeRecipeFromCookbook(
  cookbookId: number,
  recipeId: number,
  recipeType: "mealPlan" | "community",
): Promise<boolean> {
  const result = await db
    .delete(cookbookRecipes)
    .where(
      and(
        eq(cookbookRecipes.cookbookId, cookbookId),
        eq(cookbookRecipes.recipeId, recipeId),
        eq(cookbookRecipes.recipeType, recipeType),
      ),
    )
    .returning({ id: cookbookRecipes.id });
  return result.length > 0;
}

export async function getCookbookRecipes(
  cookbookId: number,
  userId: string,
): Promise<CookbookRecipe[]> {
  const rows = await db
    .select({ recipe: cookbookRecipes })
    .from(cookbookRecipes)
    .innerJoin(cookbooks, eq(cookbookRecipes.cookbookId, cookbooks.id))
    .where(
      and(
        eq(cookbookRecipes.cookbookId, cookbookId),
        eq(cookbooks.userId, userId),
      ),
    )
    .orderBy(desc(cookbookRecipes.addedAt));
  return rows.map((r) => r.recipe);
}

/**
 * Resolve cookbook recipes into displayable data using partitioned batch fetch.
 * Partitions junction rows by recipeType, batch-fetches from each source table,
 * merges via Map lookup, and fire-and-forget cleans orphaned junction rows.
 */
export async function getResolvedCookbookRecipes(
  cookbookId: number,
  userId: string,
): Promise<ResolvedCookbookRecipe[]> {
  const junctionRows = await getCookbookRecipes(cookbookId, userId);
  if (junctionRows.length === 0) return [];

  // Partition by recipeType
  const mealPlanIds: number[] = [];
  const communityIds: number[] = [];
  for (const row of junctionRows) {
    if (row.recipeType === "mealPlan") {
      mealPlanIds.push(row.recipeId);
    } else if (row.recipeType === "community") {
      communityIds.push(row.recipeId);
    }
  }

  // Batch fetch from both tables in parallel
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

  // Map lookup for O(1) access
  const mealPlanMap = new Map(mealPlanRows.map((r) => [r.id, r]));
  const communityMap = new Map(communityRows.map((r) => [r.id, r]));

  // Resolve + detect orphans
  const resolved: ResolvedCookbookRecipe[] = [];
  const orphanIds: number[] = [];

  for (const row of junctionRows) {
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
          addedAt: row.addedAt.toISOString(),
        });
      } else {
        orphanIds.push(row.id);
      }
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
          addedAt: row.addedAt.toISOString(),
        });
      } else {
        orphanIds.push(row.id);
      }
    }
  }

  // Fire-and-forget orphan cleanup
  if (orphanIds.length) {
    db.delete(cookbookRecipes)
      .where(inArray(cookbookRecipes.id, orphanIds))
      .catch(console.error);
  }

  return resolved;
}
