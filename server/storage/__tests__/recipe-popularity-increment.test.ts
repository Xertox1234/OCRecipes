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
import { communityRecipes } from "@shared/schema";
import { eq } from "drizzle-orm";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const { incrementRecipePopularity } = await import("../canonical-recipes");

let tx: NodePgDatabase<typeof schema>;
let author: schema.User;
let other: schema.User;

type RecipeOverrides = Partial<typeof communityRecipes.$inferInsert>;

async function addRecipe(overrides: RecipeOverrides) {
  const [row] = await tx
    .insert(communityRecipes)
    .values({
      normalizedProductName: "test",
      title: "Popularity test recipe",
      instructions: ["Cook"],
      ingredients: [],
      ...overrides,
    })
    .returning();
  return row;
}

async function counters(id: number) {
  const [row] = await tx
    .select({
      favorites: communityRecipes.popularityFavorites,
      mealPlans: communityRecipes.popularityMealPlans,
      cookSessions: communityRecipes.popularityCookSessions,
      score: communityRecipes.popularityScore,
    })
    .from(communityRecipes)
    .where(eq(communityRecipes.id, id));
  return row;
}

const ZERO = { favorites: 0, mealPlans: 0, cookSessions: 0, score: 0 };

// The recipe id comes from the client (a cook session or a meal-plan save can
// name any id), so the storage function decides whether the event counts.
describe("incrementRecipePopularity: which events count", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    author = await createTestUser(tx);
    other = await createTestUser(tx);
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("another user's cook, save and favourite count on a public recipe", async () => {
    const recipe = await addRecipe({ authorId: author.id, isPublic: true });
    await incrementRecipePopularity(recipe.id, "cookSession", other.id);
    await incrementRecipePopularity(recipe.id, "mealPlan", other.id);
    await incrementRecipePopularity(recipe.id, "favorite", other.id);
    expect(await counters(recipe.id)).toEqual({
      favorites: 1,
      mealPlans: 1,
      cookSessions: 1,
      score: 6,
    });
  });

  it("a private recipe's counters do not move", async () => {
    const recipe = await addRecipe({ authorId: author.id, isPublic: false });
    await incrementRecipePopularity(recipe.id, "cookSession", other.id);
    await incrementRecipePopularity(recipe.id, "mealPlan", other.id);
    await incrementRecipePopularity(recipe.id, "favorite", other.id);
    expect(await counters(recipe.id)).toEqual(ZERO);
  });

  it("the author's own cook, save and favourite do not count", async () => {
    const recipe = await addRecipe({ authorId: author.id, isPublic: true });
    await incrementRecipePopularity(recipe.id, "cookSession", author.id);
    await incrementRecipePopularity(recipe.id, "mealPlan", author.id);
    await incrementRecipePopularity(recipe.id, "favorite", author.id);
    expect(await counters(recipe.id)).toEqual(ZERO);
  });

  it("a public recipe with no author counts for anyone", async () => {
    const recipe = await addRecipe({ authorId: null, isPublic: true });
    await incrementRecipePopularity(recipe.id, "cookSession", other.id);
    expect(await counters(recipe.id)).toMatchObject({
      cookSessions: 1,
      score: 3,
    });
  });
});
