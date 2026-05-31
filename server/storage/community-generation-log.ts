import { recipeGenerationLog } from "@shared/schema";
import { db } from "../db";
import { eq, and, gte, lt, sql } from "drizzle-orm";
import { getDayBounds } from "./helpers";

// ============================================================================
// RECIPE GENERATION LOG (daily quota tracking)
// ============================================================================

export async function getDailyRecipeGenerationCount(
  userId: string,
  date: Date,
  tz: string = "UTC",
): Promise<number> {
  const { startOfDay, endOfDay } = getDayBounds(date, tz);

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

/**
 * Atomically re-check the daily generation quota and log a generation in one
 * transaction. Returns false when the caller is over the limit so the route
 * can respond 429. Used by preview endpoints that burn an AI call without
 * persisting a recipe — pass `recipeId: null` for those so the row still
 * counts against the quota.
 */
export async function logRecipeGenerationWithLimitCheck(
  userId: string,
  dailyLimit: number,
  recipeId: number | null = null,
  tz: string = "UTC",
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    const { startOfDay, endOfDay } = getDayBounds(new Date(), tz);
    const result = await tx
      .select({ count: sql<number>`count(*)` })
      .from(recipeGenerationLog)
      .where(
        and(
          eq(recipeGenerationLog.userId, userId),
          gte(recipeGenerationLog.generatedAt, startOfDay),
          lt(recipeGenerationLog.generatedAt, endOfDay),
        ),
      );
    const count = Number(result[0]?.count ?? 0);
    if (count >= dailyLimit) return false;
    await tx.insert(recipeGenerationLog).values({ userId, recipeId });
    return true;
  });
}
