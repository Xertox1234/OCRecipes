/**
 * `>= 0` CHECKs on the numeric columns that had none (audit 2026-11-05 L9,
 * migration 0039): meal_plan_recipes fiber/sugar/sodium per serving, and the
 * quantity of recipe ingredients, pantry items and grocery list items. Zod at
 * the boundary was the only guard, so any other write path could store a
 * negative that sums into totals and grocery aggregation. NULL still passes.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";
import {
  mealPlanRecipes,
  recipeIngredients,
  pantryItems,
  groceryLists,
  groceryListItems,
} from "@shared/schema";

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

/** A savepoint, so the rejected insert does not abort the test transaction. */
const insertRejected = (write: (inner: typeof tx) => Promise<unknown>) =>
  tx.transaction(async (inner) => {
    await write(inner);
  });

describe("non-negative CHECKs", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    testUser = await createTestUser(tx);
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it.each([
    ["fiberPerServing", "mpr_fiber_gte0"],
    ["sugarPerServing", "mpr_sugar_gte0"],
    ["sodiumPerServing", "mpr_sodium_gte0"],
  ] as const)(
    "meal_plan_recipes rejects a negative %s",
    async (column, constraint) => {
      await expect(
        insertRejected((inner) =>
          inner
            .insert(mealPlanRecipes)
            .values({ userId: testUser.id, title: "Negative", [column]: "-1" }),
        ),
      ).rejects.toMatchObject({ cause: { constraint } });
    },
  );

  it("recipe_ingredients rejects a negative quantity", async () => {
    const [recipe] = await tx
      .insert(mealPlanRecipes)
      .values({ userId: testUser.id, title: "Host" })
      .returning();
    await expect(
      insertRejected((inner) =>
        inner
          .insert(recipeIngredients)
          .values({ recipeId: recipe.id, name: "Flour", quantity: "-2" }),
      ),
    ).rejects.toMatchObject({
      cause: { constraint: "recipe_ingredients_quantity_gte0" },
    });
  });

  it("pantry_items rejects a negative quantity", async () => {
    await expect(
      insertRejected((inner) =>
        inner
          .insert(pantryItems)
          .values({ userId: testUser.id, name: "Rice", quantity: "-1" }),
      ),
    ).rejects.toMatchObject({
      cause: { constraint: "pantry_items_quantity_gte0" },
    });
  });

  it("grocery_list_items rejects a negative quantity", async () => {
    const [list] = await tx
      .insert(groceryLists)
      .values({
        userId: testUser.id,
        title: "Shop",
        dateRangeStart: "2026-11-01",
        dateRangeEnd: "2026-11-07",
      })
      .returning();
    await expect(
      insertRejected((inner) =>
        inner
          .insert(groceryListItems)
          .values({ groceryListId: list.id, name: "Milk", quantity: "-1" }),
      ),
    ).rejects.toMatchObject({
      cause: { constraint: "grocery_list_items_quantity_gte0" },
    });
  });

  it("still accepts null and zero", async () => {
    const [recipe] = await tx
      .insert(mealPlanRecipes)
      .values({
        userId: testUser.id,
        title: "Zero",
        fiberPerServing: "0",
        sugarPerServing: null,
        sodiumPerServing: "0",
      })
      .returning();
    await tx
      .insert(recipeIngredients)
      .values({ recipeId: recipe.id, name: "Salt", quantity: null });
    await tx
      .insert(pantryItems)
      .values({ userId: testUser.id, name: "Rice", quantity: "0" });
    expect(recipe.fiberPerServing).toBe("0.00");
  });
});
