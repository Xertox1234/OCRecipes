/**
 * Multi-connection race between favouriting a recipe and deleting it.
 *
 * Like `grocery-lists.concurrent.test.ts`, this does NOT mock `../../db` or use
 * the savepoint harness (both force one connection, which cannot race). The
 * favourite's recipe check takes FOR SHARE on the recipe row: without it, a
 * favourite whose plain existence check passed before the delete committed
 * could commit after the delete's junction cleanup — an orphan row with no FK
 * to catch it, still counted against the favourite cap.
 *
 * A race test is probabilistic: it can pass on unfixed code when the
 * interleaving never lands in the window. It guards the invariant.
 *
 * Rows are committed and cleaned up in `afterAll`.
 */
import { describe, it, expect, afterAll } from "vitest";
import { and, eq } from "drizzle-orm";
import crypto from "node:crypto";
import { db, pool } from "../../db";
import { users, mealPlanRecipes, favouriteRecipes } from "@shared/schema";
import { toggleFavouriteRecipe } from "../favourite-recipes";
import { deleteMealPlanRecipe } from "../meal-plan-recipes-crud";

const createdUserIds: string[] = [];

async function createCommittedUser(): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      username: `fav_concurrent_${crypto.randomUUID()}`,
      email: `fav_concurrent_${crypto.randomUUID()}@test.invalid`,
      password: "hashed_password_placeholder",
    })
    .returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

afterAll(async () => {
  for (const userId of createdUserIds) {
    await db.delete(users).where(eq(users.id, userId));
  }
  await pool.end();
});

describe("toggleFavouriteRecipe vs deleteMealPlanRecipe: concurrent multi-connection safety", () => {
  it("never leaves a favourite pointing at a deleted recipe", async () => {
    for (let iter = 0; iter < 20; iter++) {
      const userId = await createCommittedUser();
      const [recipe] = await db
        .insert(mealPlanRecipes)
        .values({ userId, title: `Race ${iter}` })
        .returning({ id: mealPlanRecipes.id });

      await Promise.allSettled([
        toggleFavouriteRecipe(userId, recipe.id, "mealPlan"),
        deleteMealPlanRecipe(recipe.id, userId),
      ]);

      const orphans = await db
        .select({ id: favouriteRecipes.id })
        .from(favouriteRecipes)
        .where(
          and(
            eq(favouriteRecipes.userId, userId),
            eq(favouriteRecipes.recipeId, recipe.id),
            eq(favouriteRecipes.recipeType, "mealPlan"),
          ),
        );
      expect(orphans).toHaveLength(0);
    }
  });
});
