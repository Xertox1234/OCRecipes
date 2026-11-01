import { recipeGenerationLog } from "@shared/schema";
import { db } from "../db";
import { eq, and, gte, lt, sql } from "drizzle-orm";
import type { AiCallKind } from "@shared/types/premium";
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
        eq(recipeGenerationLog.kind, "recipe"),
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
          eq(recipeGenerationLog.kind, "recipe"),
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

/**
 * Claim one paid AI call of `kind` for today, BEFORE making the call. Returns
 * false when the user is already at `dailyLimit` (the caller answers 429 and
 * must not call the AI service). The per-user/kind advisory lock serializes
 * concurrent claims, so N parallel requests can never overshoot the cap.
 * Fixed calendar day in `tz`, not a rolling 24 h. A claim is spent even if the
 * paid call then fails: the cap bounds spend, so it errs toward counting.
 */
export async function claimDailyAiCall(
  userId: string,
  kind: AiCallKind,
  dailyLimit: number,
  tz: string = "UTC",
): Promise<boolean> {
  return await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${kind}`}, 0))`,
    );
    const { startOfDay, endOfDay } = getDayBounds(new Date(), tz);
    const result = await tx
      .select({ count: sql<number>`count(*)` })
      .from(recipeGenerationLog)
      .where(
        and(
          eq(recipeGenerationLog.userId, userId),
          eq(recipeGenerationLog.kind, kind),
          gte(recipeGenerationLog.generatedAt, startOfDay),
          lt(recipeGenerationLog.generatedAt, endOfDay),
        ),
      );
    if (Number(result[0]?.count ?? 0) >= dailyLimit) return false;
    await tx.insert(recipeGenerationLog).values({ userId, kind });
    return true;
  });
}
