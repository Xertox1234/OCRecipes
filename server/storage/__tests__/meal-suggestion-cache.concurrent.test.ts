/**
 * Multi-connection concurrency test for the meal-suggestion daily limit.
 *
 * Like `grocery-lists.concurrent.test.ts`, this does NOT mock `../../db` or use
 * the savepoint harness (both force a single connection, which cannot race).
 * Parallel calls check out distinct pool connections, so each is a genuine
 * separate transaction. Without the advisory lock, READ COMMITTED lets two
 * calls both count limit - 1 and both insert, landing the user over the limit.
 *
 * Rows are committed and cleaned up in `afterAll` (meal_suggestion_cache
 * cascades from users on delete).
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { db, pool } from "../../db";
import { users, mealSuggestionCache } from "@shared/schema";
import type { MealSuggestion } from "@shared/types/meal-suggestions";
import { createMealSuggestionCacheWithLimitCheck } from "../cache";

const DAILY_LIMIT = 3;
const createdUserIds: string[] = [];

const suggestion: MealSuggestion = {
  title: "Grilled Chicken Bowl",
  description: "Grilled chicken with veggies",
  reasoning: "High protein",
  calories: 500,
  protein: 40,
  carbs: 30,
  fat: 15,
  prepTimeMinutes: 25,
  difficulty: "Easy",
  ingredients: [{ name: "Chicken breast", quantity: "200", unit: "g" }],
  instructions: ["Grill chicken."],
  dietTags: [],
};

async function createCommittedUser(): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      username: `meal_sugg_concurrent_${crypto.randomUUID()}`,
      email: `meal_sugg_concurrent_${crypto.randomUUID()}@test.invalid`,
      password: "hashed_password_placeholder",
    })
    .returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function committedCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(mealSuggestionCache)
    .where(eq(mealSuggestionCache.userId, userId));
  return row.count;
}

const expiresAt = () => new Date(Date.now() + 6 * 60 * 60 * 1000);

afterAll(async () => {
  for (const userId of createdUserIds) {
    await db.delete(users).where(eq(users.id, userId));
  }
  await pool.end();
});

describe("createMealSuggestionCacheWithLimitCheck: concurrent multi-connection safety", () => {
  it("creates exactly one entry when two requests race at dailyLimit - 1", async () => {
    for (let iter = 0; iter < 10; iter++) {
      const userId = await createCommittedUser();
      for (let i = 0; i < DAILY_LIMIT - 1; i++) {
        await db.insert(mealSuggestionCache).values({
          cacheKey: `${userId}:seed:${i}`,
          userId,
          suggestions: [suggestion],
          expiresAt: expiresAt(),
        });
      }

      const results = await Promise.all([
        createMealSuggestionCacheWithLimitCheck(
          `${userId}:race:a`,
          userId,
          [suggestion],
          expiresAt(),
          DAILY_LIMIT,
        ),
        createMealSuggestionCacheWithLimitCheck(
          `${userId}:race:b`,
          userId,
          [suggestion],
          expiresAt(),
          DAILY_LIMIT,
        ),
      ]);

      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect(await committedCount(userId)).toBe(DAILY_LIMIT);
    }
  });
});
