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
import { communityRecipes, mealPlanRecipes } from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  loadCommunitySpiceRows,
  loadMealPlanSpiceRows,
  loadCommunityNutritionRows,
  loadCommunityImageRows,
  loadMealPlanImageRows,
} = await import("../backfill-ai-rows");

let tx: NodePgDatabase<typeof schema>;
let allowed: schema.User;
let aiOff: schema.User;

async function addCommunity(
  title: string,
  overrides: Partial<typeof communityRecipes.$inferInsert>,
) {
  await tx.insert(communityRecipes).values({
    normalizedProductName: "test",
    title,
    instructions: ["Cook"],
    ingredients: [],
    ...overrides,
  });
}

async function addMealPlan(title: string, userId: string) {
  await tx.insert(mealPlanRecipes).values({ userId, title });
}

/** Other rows may exist in the test database; look only at this test's. */
function mine(rows: { title: string }[]): string[] {
  return rows
    .map((r) => r.title)
    .filter((t) => t.startsWith("m13 "))
    .sort();
}

// Privacy audit M13 — the backfill scripts send recipe text to AI companies
// outside any signed-in request, so the rows they load must leave out
// recipes whose owner has AI sharing off.
describe("backfill row loaders: who may be sent to AI", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    allowed = await createTestUser(tx, { aiSharingAllowedAt: new Date() });
    aiOff = await createTestUser(tx);

    await addCommunity("m13 community allowed", { authorId: allowed.id });
    await addCommunity("m13 community ai off", { authorId: aiOff.id });
    await addCommunity("m13 community platform", { authorId: null });
    await addMealPlan("m13 mealplan allowed", allowed.id);
    await addMealPlan("m13 mealplan ai off", aiOff.id);
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  const COMMUNITY_OK = ["m13 community allowed", "m13 community platform"];

  it("spice level: community rows leave out an author with AI off", async () => {
    expect(mine(await loadCommunitySpiceRows())).toEqual(COMMUNITY_OK);
  });

  it("spice level: meal-plan rows leave out an owner with AI off", async () => {
    expect(mine(await loadMealPlanSpiceRows())).toEqual([
      "m13 mealplan allowed",
    ]);
  });

  it("nutrition: community rows leave out an author with AI off", async () => {
    expect(mine(await loadCommunityNutritionRows())).toEqual(COMMUNITY_OK);
  });

  it("images: community rows leave out an author with AI off", async () => {
    expect(mine(await loadCommunityImageRows())).toEqual(COMMUNITY_OK);
  });

  it("images: meal-plan rows leave out an owner with AI off", async () => {
    expect(mine(await loadMealPlanImageRows())).toEqual([
      "m13 mealplan allowed",
    ]);
  });
});
