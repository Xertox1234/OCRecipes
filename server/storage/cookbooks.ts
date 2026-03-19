import {
  type Cookbook,
  type InsertCookbook,
  type CookbookRecipe,
  cookbooks,
  cookbookRecipes,
} from "@shared/schema";
import { db } from "../db";
import { eq, and, desc, sql } from "drizzle-orm";

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
): Promise<Cookbook[]> {
  return db
    .select()
    .from(cookbooks)
    .where(eq(cookbooks.userId, userId))
    .orderBy(desc(cookbooks.updatedAt))
    .limit(limit);
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
  recipeType: string,
): Promise<CookbookRecipe | undefined> {
  const [added] = await db
    .insert(cookbookRecipes)
    .values({ cookbookId, recipeId, recipeType })
    .onConflictDoNothing()
    .returning();
  return added || undefined;
}

export async function removeRecipeFromCookbook(
  cookbookId: number,
  recipeId: number,
  recipeType: string,
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
