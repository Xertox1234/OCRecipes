import {
  type SuggestionData,
  type MealSuggestionCacheEntry,
  nutritionCache,
  suggestionCache,
  instructionCache,
  mealSuggestionCache,
  micronutrientCache,
} from "@shared/schema";
import type { MealSuggestion } from "@shared/types/meal-suggestions";
import { db } from "../db";
import { fireAndForget } from "../lib/fire-and-forget";
import { eq, and, gte, gt, lt, lte, sql } from "drizzle-orm";
import { getDayBounds } from "./helpers";

// ============================================================================
// SUGGESTION CACHE
// ============================================================================

export async function getSuggestionCache(
  scannedItemId: number,
  userId: string,
  profileHash: string,
): Promise<{ id: number; suggestions: SuggestionData[] } | undefined> {
  const [cached] = await db
    .select({
      id: suggestionCache.id,
      suggestions: suggestionCache.suggestions,
    })
    .from(suggestionCache)
    .where(
      and(
        eq(suggestionCache.scannedItemId, scannedItemId),
        eq(suggestionCache.userId, userId),
        eq(suggestionCache.profileHash, profileHash),
        gt(suggestionCache.expiresAt, new Date()),
      ),
    );
  return cached || undefined;
}

export async function createSuggestionCache(
  scannedItemId: number,
  userId: string,
  profileHash: string,
  suggestions: SuggestionData[],
  expiresAt: Date,
): Promise<{ id: number }> {
  const [result] = await db
    .insert(suggestionCache)
    .values({
      scannedItemId,
      userId,
      profileHash,
      suggestions,
      expiresAt,
    })
    .returning({ id: suggestionCache.id });
  return result;
}

export async function incrementSuggestionCacheHit(id: number): Promise<void> {
  await db
    .update(suggestionCache)
    .set({ hitCount: sql`${suggestionCache.hitCount} + 1` })
    .where(eq(suggestionCache.id, id));
}

// ============================================================================
// INSTRUCTION CACHE
// ============================================================================

export async function getInstructionCache(
  suggestionCacheId: number,
  suggestionIndex: number,
): Promise<{ id: number; instructions: string } | undefined> {
  const [cached] = await db
    .select({
      id: instructionCache.id,
      instructions: instructionCache.instructions,
    })
    .from(instructionCache)
    .where(
      and(
        eq(instructionCache.suggestionCacheId, suggestionCacheId),
        eq(instructionCache.suggestionIndex, suggestionIndex),
      ),
    );
  return cached || undefined;
}

export async function createInstructionCache(
  suggestionCacheId: number,
  suggestionIndex: number,
  suggestionTitle: string,
  suggestionType: string,
  instructions: string,
): Promise<void> {
  await db.insert(instructionCache).values({
    suggestionCacheId,
    suggestionIndex,
    suggestionTitle,
    suggestionType,
    instructions,
  });
}

export async function incrementInstructionCacheHit(id: number): Promise<void> {
  await db
    .update(instructionCache)
    .set({ hitCount: sql`${instructionCache.hitCount} + 1` })
    .where(eq(instructionCache.id, id));
}

// ============================================================================
// INVALIDATION
// ============================================================================

export async function invalidateSuggestionCacheForUser(
  userId: string,
): Promise<number> {
  const result = await db
    .delete(suggestionCache)
    .where(eq(suggestionCache.userId, userId))
    .returning({ id: suggestionCache.id });
  return result.length;
}

// ============================================================================
// MEAL SUGGESTION CACHE
// ============================================================================

export async function getMealSuggestionCache(
  cacheKey: string,
): Promise<MealSuggestionCacheEntry | undefined> {
  const [cached] = await db
    .select()
    .from(mealSuggestionCache)
    .where(
      and(
        eq(mealSuggestionCache.cacheKey, cacheKey),
        gt(mealSuggestionCache.expiresAt, new Date()),
      ),
    );
  return cached || undefined;
}

export async function createMealSuggestionCache(
  cacheKey: string,
  userId: string,
  suggestions: MealSuggestion[],
  expiresAt: Date,
): Promise<MealSuggestionCacheEntry> {
  const [created] = await db
    .insert(mealSuggestionCache)
    .values({ cacheKey, userId, suggestions, expiresAt })
    .returning();
  return created;
}

export async function incrementMealSuggestionCacheHit(
  id: number,
): Promise<void> {
  await db
    .update(mealSuggestionCache)
    .set({ hitCount: sql`${mealSuggestionCache.hitCount} + 1` })
    .where(eq(mealSuggestionCache.id, id));
}

export async function getDailyMealSuggestionCount(
  userId: string,
  date: Date,
): Promise<number> {
  const { startOfDay, endOfDay } = getDayBounds(date);

  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(mealSuggestionCache)
    .where(
      and(
        eq(mealSuggestionCache.userId, userId),
        gte(mealSuggestionCache.createdAt, startOfDay),
        lt(mealSuggestionCache.createdAt, endOfDay),
      ),
    );

  return Number(result[0]?.count ?? 0);
}

// ============================================================================
// MICRONUTRIENT CACHE
// ============================================================================

export async function getMicronutrientCache(
  queryKey: string,
): Promise<unknown[] | undefined> {
  const [row] = await db
    .select()
    .from(micronutrientCache)
    .where(
      and(
        eq(micronutrientCache.queryKey, queryKey),
        gt(micronutrientCache.expiresAt, new Date()),
      ),
    );
  if (!row) return undefined;
  fireAndForget(
    "cache-hit-increment",
    db
      .update(micronutrientCache)
      .set({ hitCount: sql`${micronutrientCache.hitCount} + 1` })
      .where(eq(micronutrientCache.id, row.id)),
  );
  return row.data as unknown[];
}

export async function setMicronutrientCache(
  queryKey: string,
  data: unknown[],
  ttlMs: number,
): Promise<void> {
  const expiresAt = new Date(Date.now() + ttlMs);
  await db
    .insert(micronutrientCache)
    .values({ queryKey, data, expiresAt })
    .onConflictDoUpdate({
      target: micronutrientCache.queryKey,
      set: { data, expiresAt, hitCount: 0 },
    });
}

// ============================================================================
// EXPIRED CACHE CLEANUP
// ============================================================================

const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Delete expired rows from all cache tables.
 * Called periodically via setInterval to prevent unbounded table growth.
 */
export async function purgeExpiredCacheRows(): Promise<number> {
  const now = new Date();
  const tables = [
    nutritionCache,
    micronutrientCache,
    suggestionCache,
    mealSuggestionCache,
  ] as const;

  let totalDeleted = 0;
  for (const table of tables) {
    const result = await db
      .delete(table)
      .where(lte(table.expiresAt, now))
      .returning({ id: table.id });
    totalDeleted += result.length;
  }

  // instructionCache cascades from suggestionCache, but clean orphans just in case
  if (totalDeleted > 0) {
    console.warn(`Cache cleanup: purged ${totalDeleted} expired rows`);
  }
  return totalDeleted;
}

/**
 * Start the periodic cache cleanup job. Returns the interval ID for cleanup.
 */
export function startCacheCleanupJob(): ReturnType<typeof setInterval> {
  return setInterval(() => {
    purgeExpiredCacheRows().catch((err) => {
      console.error("Cache cleanup error:", err);
    });
  }, CLEANUP_INTERVAL_MS);
}
