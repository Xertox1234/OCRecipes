import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import type * as schema from "@shared/schema";
import {
  mealPlanRecipes,
  recipeIngredients,
  mealPlanItems,
  dailyLogs,
  cookbooks,
  cookbookRecipes,
  favouriteRecipes,
} from "@shared/schema";

// Deleting a personal recipe is a SOFT delete: daily_logs.recipe_id points at
// the recipe, and a hard delete cascaded those logs away — the user's past days
// silently lost the calories. These tests pin both halves of the contract: the
// logged history survives, and the recipe vanishes from every user-facing read.

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

vi.mock("../../lib/search-index", () => ({
  addToIndex: vi.fn(),
  removeFromIndex: vi.fn(),
  mealPlanToSearchable: vi.fn((r: { id: number }) => ({
    id: `personal:${r.id}`,
  })),
  getDocumentStore: vi.fn(() => new Map()),
}));

const { pending } = vi.hoisted(() => ({
  pending: [] as Promise<unknown>[],
}));
vi.mock("../../lib/fire-and-forget", () => ({
  fireAndForget: (_label: string, promise: Promise<unknown>) => {
    pending.push(promise);
  },
}));

const {
  getMealPlanRecipe,
  getMealPlanRecipeWithIngredients,
  getUserMealPlanRecipes,
  updateMealPlanRecipe,
  deleteMealPlanRecipe,
  getAllMealPlanRecipes,
  getUnifiedRecipes,
  getRecipesWithEmptyMealTypes,
} = await import("../meal-plan-recipes");
const { getDailySummary } = await import("../nutrition");
const { getMealPlanItems, getMealPlanItemById } = await import(
  "../meal-plan-items"
);
const { getFrequentRecipesForMealType, getPopularPicksByMealType } =
  await import("../meal-plan-analytics");
const { toggleFavouriteRecipe, getResolvedFavouriteRecipes } = await import(
  "../favourite-recipes"
);
const { getUserCookbooks, addRecipeToCookbook, getResolvedCookbookRecipes } =
  await import("../cookbooks");
const { getRecipeSharePayload } = await import("../community-recipes");
const searchIndex = await import("../../lib/search-index");

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;

async function settle() {
  await Promise.all(pending.splice(0));
}

async function seedRecipe(
  userId: string,
  overrides: Partial<schema.InsertMealPlanRecipe> = {},
): Promise<schema.MealPlanRecipe> {
  const [recipe] = await tx
    .insert(mealPlanRecipes)
    .values({
      userId,
      title: "Lentil soup",
      instructions: ["Simmer"],
      mealTypes: ["lunch"],
      caloriesPerServing: "400",
      proteinPerServing: "20",
      carbsPerServing: "50",
      fatPerServing: "10",
      ...overrides,
    })
    .returning();
  return recipe;
}

async function deletedAtOf(id: number): Promise<Date | null> {
  const [row] = await tx
    .select({ deletedAt: mealPlanRecipes.deletedAt })
    .from(mealPlanRecipes)
    .where(eq(mealPlanRecipes.id, id));
  return row.deletedAt;
}

describe("deleteMealPlanRecipe soft-deletes", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    user = await createTestUser(tx);
    pending.length = 0;
    vi.mocked(searchIndex.removeFromIndex).mockClear();
    vi.mocked(searchIndex.addToIndex).mockClear();
  });

  afterEach(async () => {
    await settle();
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  describe("logged history survives", () => {
    it("keeps the daily_logs row and the day's totals", async () => {
      const recipe = await seedRecipe(user.id);
      const [log] = await tx
        .insert(dailyLogs)
        .values({
          userId: user.id,
          recipeId: recipe.id,
          servings: "2",
          source: "recipe",
        })
        .returning();
      const before = await getDailySummary(user.id, new Date(), "UTC");
      expect(Number(before.totalCalories)).toBe(800);

      expect(await deleteMealPlanRecipe(recipe.id, user.id)).toBe(true);

      const logs = await tx
        .select()
        .from(dailyLogs)
        .where(eq(dailyLogs.id, log.id));
      expect(logs).toHaveLength(1);
      expect(logs[0].recipeId).toBe(recipe.id);

      const after = await getDailySummary(user.id, new Date(), "UTC");
      expect(Number(after.totalCalories)).toBe(800);
      expect(Number(after.totalProtein)).toBe(40);
      expect(Number(after.totalCarbs)).toBe(100);
      expect(Number(after.totalFat)).toBe(20);
      expect(Number(after.itemCount)).toBe(1);
    });

    it("stamps deleted_at instead of removing the row", async () => {
      const recipe = await seedRecipe(user.id);
      expect(await deletedAtOf(recipe.id)).toBeNull();

      await deleteMealPlanRecipe(recipe.id, user.id);

      expect(await deletedAtOf(recipe.id)).toBeInstanceOf(Date);
    });

    it("removes the recipe's meal-plan items but keeps a log confirmed from one", async () => {
      const recipe = await seedRecipe(user.id);
      const [item] = await tx
        .insert(mealPlanItems)
        .values({
          userId: user.id,
          recipeId: recipe.id,
          plannedDate: "2026-10-20",
          mealType: "lunch",
        })
        .returning();
      const [log] = await tx
        .insert(dailyLogs)
        .values({
          userId: user.id,
          recipeId: recipe.id,
          mealPlanItemId: item.id,
          source: "meal_plan",
        })
        .returning();

      await deleteMealPlanRecipe(recipe.id, user.id);

      const items = await tx
        .select()
        .from(mealPlanItems)
        .where(eq(mealPlanItems.id, item.id));
      expect(items).toEqual([]);
      const [kept] = await tx
        .select()
        .from(dailyLogs)
        .where(eq(dailyLogs.id, log.id));
      expect(kept.recipeId).toBe(recipe.id);
      expect(kept.mealPlanItemId).toBeNull();
    });
  });

  describe("ownership and idempotency", () => {
    it("a different user cannot delete the recipe", async () => {
      const owner = await createTestUser(tx);
      const recipe = await seedRecipe(owner.id);

      expect(await deleteMealPlanRecipe(recipe.id, user.id)).toBe(false);

      expect(await deletedAtOf(recipe.id)).toBeNull();
      expect(await getMealPlanRecipe(recipe.id, owner.id)).toBeDefined();
      expect(searchIndex.removeFromIndex).not.toHaveBeenCalled();
    });

    it("deleting an already-deleted recipe returns false", async () => {
      const recipe = await seedRecipe(user.id);
      expect(await deleteMealPlanRecipe(recipe.id, user.id)).toBe(true);
      expect(await deleteMealPlanRecipe(recipe.id, user.id)).toBe(false);
    });

    it("an edit to a deleted recipe is refused and does not re-index it", async () => {
      const recipe = await seedRecipe(user.id);
      await deleteMealPlanRecipe(recipe.id, user.id);
      vi.mocked(searchIndex.addToIndex).mockClear();

      expect(
        await updateMealPlanRecipe(recipe.id, user.id, { title: "Back" }),
      ).toBeUndefined();
      expect(searchIndex.addToIndex).not.toHaveBeenCalled();
    });

    it("the same catalog recipe can be saved again after a delete", async () => {
      const recipe = await seedRecipe(user.id, { externalId: "ext-42" });
      await deleteMealPlanRecipe(recipe.id, user.id);

      await expect(
        seedRecipe(user.id, { externalId: "ext-42" }),
      ).resolves.toBeDefined();
    });
  });

  describe("the deleted recipe vanishes from user-facing reads", () => {
    it("detail and list reads", async () => {
      const recipe = await seedRecipe(user.id);
      const kept = await seedRecipe(user.id, { title: "Kept" });
      await tx
        .insert(recipeIngredients)
        .values({ recipeId: recipe.id, name: "lentils" });
      await deleteMealPlanRecipe(recipe.id, user.id);

      expect(await getMealPlanRecipe(recipe.id, user.id)).toBeUndefined();
      expect(
        await getMealPlanRecipeWithIngredients(recipe.id, user.id),
      ).toBeUndefined();

      const list = await getUserMealPlanRecipes(user.id);
      expect(list.items.map((r) => r.id)).toEqual([kept.id]);
      expect(list.total).toBe(1);
    });

    it("search: the index loader, the unified browse, and the meal-type backfill", async () => {
      const recipe = await seedRecipe(user.id, {
        title: "Ghost stew",
        mealTypes: [],
      });
      await deleteMealPlanRecipe(recipe.id, user.id);

      expect(searchIndex.removeFromIndex).toHaveBeenCalledWith(
        `personal:${recipe.id}`,
      );
      const all = await getAllMealPlanRecipes();
      expect(all.map((r) => r.id)).not.toContain(recipe.id);

      const unified = await getUnifiedRecipes({
        userId: user.id,
        query: "Ghost",
      });
      expect(unified.personal).toEqual([]);

      const backfill = await getRecipesWithEmptyMealTypes();
      expect(backfill.recipes.map((r) => r.id)).not.toContain(recipe.id);
    });

    it("meal-plan reads and pickers", async () => {
      const other = await createTestUser(tx);
      const mine = await seedRecipe(user.id);
      // Unique title: the popular-picks read is table-wide, so the assertion
      // is scoped to this test's own row.
      const pickTitle = `Popular pick ${other.id}`;
      const theirs = await seedRecipe(other.id, {
        title: pickTitle,
        sourceType: "ai_suggestion",
      });
      await deleteMealPlanRecipe(mine.id, user.id);
      await deleteMealPlanRecipe(theirs.id, other.id);

      // The delete clears these rows; they are re-inserted directly to prove
      // each read filters a deleted recipe on its own.
      const [item] = await tx
        .insert(mealPlanItems)
        .values({
          userId: user.id,
          recipeId: mine.id,
          plannedDate: "2026-10-20",
          mealType: "lunch",
        })
        .returning();
      await tx.insert(mealPlanItems).values({
        userId: other.id,
        recipeId: theirs.id,
        plannedDate: "2026-10-20",
        mealType: "lunch",
      });

      const items = await getMealPlanItems(user.id, "2026-10-19", "2026-10-21");
      expect(items).toHaveLength(1);
      expect(items[0].recipe).toBeNull();
      expect((await getMealPlanItemById(item.id, user.id))?.recipe).toBeNull();
      expect(await getFrequentRecipesForMealType(user.id, "lunch")).toEqual([]);
      const picks = await getPopularPicksByMealType(user.id, "lunch", 100);
      expect(picks.map((p) => p.title)).not.toContain(pickTitle);
    });

    it("favourites, cookbooks and sharing", async () => {
      const recipe = await seedRecipe(user.id);
      const [cookbook] = await tx
        .insert(cookbooks)
        .values({ userId: user.id, name: "Soups" })
        .returning();
      await deleteMealPlanRecipe(recipe.id, user.id);

      // A junction row left behind (e.g. written by a racing request) must
      // not bring the recipe back into a list.
      await tx.insert(favouriteRecipes).values({
        userId: user.id,
        recipeId: recipe.id,
        recipeType: "mealPlan",
      });
      await tx.insert(cookbookRecipes).values({
        cookbookId: cookbook.id,
        recipeId: recipe.id,
        recipeType: "mealPlan",
      });

      expect(await getResolvedFavouriteRecipes(user.id)).toEqual([]);
      expect(await getResolvedCookbookRecipes(cookbook.id, user.id)).toEqual(
        [],
      );
      const [book] = await getUserCookbooks(user.id);
      expect(Number(book.recipeCount)).toBe(0);
      await settle();

      await tx
        .delete(favouriteRecipes)
        .where(eq(favouriteRecipes.userId, user.id));
      expect(await toggleFavouriteRecipe(user.id, recipe.id, "mealPlan")).toBe(
        false,
      );
      expect(
        await addRecipeToCookbook(cookbook.id, recipe.id, "mealPlan", user.id),
      ).toBeUndefined();
      expect(
        await getRecipeSharePayload(recipe.id, "mealPlan", user.id),
      ).toBeNull();
    });
  });
});
