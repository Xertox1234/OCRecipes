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
import type * as schema from "@shared/schema";
import { mealPlanRecipes, recipeIngredients } from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const { getUserDataExport } = await import("../export");

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;

// A deleted recipe is still held (past daily logs point at it), so the
// "everything we hold" export keeps it — but in its own list, so it is never
// read as one of the user's live recipes.
describe("data export — deleted personal recipes", () => {
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

  it("lists deleted recipes separately from live ones, ingredients included", async () => {
    const [live, deleted] = await tx
      .insert(mealPlanRecipes)
      .values([
        { userId: user.id, title: "Live stew" },
        { userId: user.id, title: "Deleted curry", deletedAt: new Date() },
      ])
      .returning({ id: mealPlanRecipes.id });
    await tx.insert(recipeIngredients).values({
      recipeId: deleted.id,
      name: "Chickpeas",
      displayOrder: 0,
    });

    const data = await getUserDataExport(user.id);

    expect(data.mealPlans.recipes.map((r) => r.id)).toEqual([live.id]);
    expect(data.mealPlans.deletedRecipes).toHaveLength(1);
    expect(data.mealPlans.deletedRecipes[0]).toMatchObject({
      id: deleted.id,
      title: "Deleted curry",
      deletedAt: expect.any(Date),
      ingredients: [expect.objectContaining({ name: "Chickpeas" })],
    });
  });
});
