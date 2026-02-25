import {
  type CommunityRecipe,
  type InsertCommunityRecipe,
  communityRecipes,
  recipeGenerationLog,
} from "@shared/schema";
import { db } from "../db";
import { eq, desc, and, gte, lt, sql, or, ilike } from "drizzle-orm";
import { escapeLike, getDayBounds } from "./helpers";

// ============================================================================
// COMMUNITY RECIPES
// ============================================================================

export async function getDailyRecipeGenerationCount(
  userId: string,
  date: Date,
): Promise<number> {
  const { startOfDay, endOfDay } = getDayBounds(date);

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(recipeGenerationLog)
    .where(
      and(
        eq(recipeGenerationLog.userId, userId),
        gte(recipeGenerationLog.generatedAt, startOfDay),
        lt(recipeGenerationLog.generatedAt, endOfDay),
      ),
    );

  return Number(result[0]?.count ?? 0);
}

export async function logRecipeGeneration(
  userId: string,
  recipeId: number,
): Promise<void> {
  await db.insert(recipeGenerationLog).values({
    userId,
    recipeId,
  });
}

export async function getCommunityRecipes(
  barcode: string | null,
  normalizedProductName: string,
): Promise<CommunityRecipe[]> {
  // Try exact barcode match first, then fall back to fuzzy name match
  const conditions = [eq(communityRecipes.isPublic, true)];

  if (barcode) {
    // With barcode: match by barcode OR similar product name
    conditions.push(
      or(
        eq(communityRecipes.barcode, barcode),
        ilike(
          communityRecipes.normalizedProductName,
          `%${escapeLike(normalizedProductName)}%`,
        ),
      )!,
    );
  } else {
    // Without barcode: fuzzy match on product name only
    conditions.push(
      ilike(
        communityRecipes.normalizedProductName,
        `%${escapeLike(normalizedProductName)}%`,
      ),
    );
  }

  return db
    .select()
    .from(communityRecipes)
    .where(and(...conditions))
    .orderBy(desc(communityRecipes.likeCount), desc(communityRecipes.createdAt))
    .limit(10);
}

export async function createCommunityRecipe(
  data: Omit<InsertCommunityRecipe, "id" | "createdAt" | "updatedAt">,
): Promise<CommunityRecipe> {
  const [recipe] = await db.insert(communityRecipes).values(data).returning();
  return recipe;
}

export async function updateRecipePublicStatus(
  recipeId: number,
  authorId: string,
  isPublic: boolean,
): Promise<CommunityRecipe | undefined> {
  const [recipe] = await db
    .update(communityRecipes)
    .set({ isPublic, updatedAt: new Date() })
    .where(
      and(
        eq(communityRecipes.id, recipeId),
        eq(communityRecipes.authorId, authorId),
      ),
    )
    .returning();
  return recipe || undefined;
}

export async function getCommunityRecipe(
  id: number,
): Promise<CommunityRecipe | undefined> {
  const [recipe] = await db
    .select()
    .from(communityRecipes)
    .where(eq(communityRecipes.id, id));
  return recipe || undefined;
}

export async function getFeaturedRecipes(
  limit = 12,
  offset = 0,
): Promise<CommunityRecipe[]> {
  return db
    .select()
    .from(communityRecipes)
    .where(eq(communityRecipes.isPublic, true))
    .orderBy(desc(communityRecipes.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function deleteCommunityRecipe(
  recipeId: number,
  authorId: string,
): Promise<boolean> {
  // IDOR protection: only delete if owned by user
  const result = await db
    .delete(communityRecipes)
    .where(
      and(
        eq(communityRecipes.id, recipeId),
        eq(communityRecipes.authorId, authorId),
      ),
    )
    .returning({ id: communityRecipes.id });

  return result.length > 0;
}

export async function getUserRecipes(
  userId: string,
  limit = 50,
  offset = 0,
): Promise<{ items: CommunityRecipe[]; total: number }> {
  const [items, countResult] = await Promise.all([
    db
      .select()
      .from(communityRecipes)
      .where(eq(communityRecipes.authorId, userId))
      .orderBy(desc(communityRecipes.createdAt))
      .limit(limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)` })
      .from(communityRecipes)
      .where(eq(communityRecipes.authorId, userId)),
  ]);
  return { items, total: Number(countResult[0]?.count ?? 0) };
}
