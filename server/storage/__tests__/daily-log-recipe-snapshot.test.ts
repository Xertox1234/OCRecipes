import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";
import { mealPlanRecipes, scannedItems, dailyLogs } from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const { createDailyLog, getDailySummary } = await import("../nutrition");

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;

// A logged recipe keeps the nutrition it had when it was eaten — editing the
// recipe afterwards must not rewrite past days' totals.
describe("daily log — recipe nutrition snapshot", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    user = await createTestUser(tx);
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  it("keeps a logged recipe's totals after the recipe is edited", async () => {
    const [recipe] = await tx
      .insert(mealPlanRecipes)
      .values({
        userId: user.id,
        title: "Stew",
        caloriesPerServing: "500",
        proteinPerServing: "30",
        carbsPerServing: "40",
        fatPerServing: "20",
      })
      .returning({ id: mealPlanRecipes.id });

    const log = await createDailyLog({
      userId: user.id,
      recipeId: recipe.id,
      source: "meal_plan_confirm",
      servings: "2",
    });
    expect(log).toMatchObject({
      calories: "500.00",
      protein: "30.00",
      carbs: "40.00",
      fat: "20.00",
    });

    await tx
      .update(mealPlanRecipes)
      .set({
        caloriesPerServing: "100",
        proteinPerServing: "1",
        carbsPerServing: "1",
        fatPerServing: "1",
      })
      .where(eq(mealPlanRecipes.id, recipe.id));

    const summary = await getDailySummary(user.id, new Date(), "UTC");
    expect(Number(summary.totalCalories)).toBe(1000);
    expect(Number(summary.totalProtein)).toBe(60);
    expect(Number(summary.totalCarbs)).toBe(80);
    expect(Number(summary.totalFat)).toBe(40);
  });

  it("snapshots a missing recipe value as 0, not as 'not snapshotted'", async () => {
    const [recipe] = await tx
      .insert(mealPlanRecipes)
      .values({ userId: user.id, title: "Bare", caloriesPerServing: "250" })
      .returning({ id: mealPlanRecipes.id });

    const log = await createDailyLog({
      userId: user.id,
      recipeId: recipe.id,
      source: "meal_plan_confirm",
    });

    expect(log).toMatchObject({
      calories: "250.00",
      protein: "0.00",
      carbs: "0.00",
      fat: "0.00",
    });
  });

  it("still sums scan logs from the scanned item, with no snapshot", async () => {
    const [item] = await tx
      .insert(scannedItems)
      .values({ userId: user.id, productName: "Apple", calories: "95" })
      .returning({ id: scannedItems.id });

    const log = await createDailyLog({
      userId: user.id,
      scannedItemId: item.id,
      source: "scan",
    });
    expect(log.calories).toBeNull();

    const summary = await getDailySummary(user.id, new Date(), "UTC");
    expect(Number(summary.totalCalories)).toBe(95);
  });

  it("falls back to the live recipe for a log written before snapshots existed", async () => {
    const [recipe] = await tx
      .insert(mealPlanRecipes)
      .values({ userId: user.id, title: "Old", caloriesPerServing: "300" })
      .returning({ id: mealPlanRecipes.id });
    // Raw insert: what the previous server wrote — recipe id, no snapshot.
    await tx
      .insert(dailyLogs)
      .values({ userId: user.id, recipeId: recipe.id, source: "recipe" });

    const summary = await getDailySummary(user.id, new Date(), "UTC");
    expect(Number(summary.totalCalories)).toBe(300);
  });
});
