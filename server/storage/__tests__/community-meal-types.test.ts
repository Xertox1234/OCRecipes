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
import { eq } from "drizzle-orm";
import { communityRecipes } from "@shared/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";

// Mock the db import so the storage functions use our test transaction.
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Mock the search-index singleton so tests don't mutate process-wide index
// state. `getDocumentStore` returns a per-test Map tests can pre-seed to
// exercise the "refresh existing entry" branch in batchUpdateCommunityMealTypes.
let mockDocumentStore = new Map<string, unknown>();
vi.mock("../../lib/search-index", () => ({
  addToIndex: vi.fn(),
  removeFromIndex: vi.fn(),
  communityToSearchable: vi.fn((r: { id: number }) => ({
    id: `community:${r.id}`,
  })),
  getDocumentStore: vi.fn(() => mockDocumentStore),
}));

// Import after mocking.
const { createCommunityRecipe } = await import("../community-recipes");
const { getCommunityRecipesWithEmptyMealTypes, batchUpdateCommunityMealTypes } =
  await import("../community-meal-types");
const searchIndex = await import("../../lib/search-index");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

/** Insert a public community recipe with sensible defaults. */
async function createTestRecipe(
  userId: string,
  overrides: Record<string, unknown> = {},
) {
  return createCommunityRecipe({
    authorId: userId,
    title: "Test Recipe",
    description: "Test description",
    // `test-` prefix so cleanup catches any row that leaks past rollback.
    normalizedProductName: "test-food",
    instructions: ["Mix and bake"],
    isPublic: true,
    ...overrides,
  });
}

describe("community-meal-types storage", () => {
  beforeEach(async () => {
    mockDocumentStore = new Map();
    tx = await setupTestTransaction();
    testUser = await createTestUser(tx);
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  describe("getCommunityRecipesWithEmptyMealTypes", () => {
    it("returns recipes with empty mealTypes and excludes classified ones", async () => {
      const empty = await createTestRecipe(testUser.id, { mealTypes: [] });
      const classified = await createTestRecipe(testUser.id, {
        mealTypes: ["lunch"],
      });

      const result = await getCommunityRecipesWithEmptyMealTypes();
      const ids = result.map((r) => r.id);
      expect(ids).toContain(empty.id);
      expect(ids).not.toContain(classified.id);
    });
  });

  describe("batchUpdateCommunityMealTypes", () => {
    it("returns 0 for an empty update list", async () => {
      const count = await batchUpdateCommunityMealTypes([]);
      expect(count).toBe(0);
    });

    it("updates mealTypes for multiple recipes in one round-trip", async () => {
      const r1 = await createTestRecipe(testUser.id, { mealTypes: [] });
      const r2 = await createTestRecipe(testUser.id, { mealTypes: [] });

      const count = await batchUpdateCommunityMealTypes([
        { id: r1.id, mealTypes: ["breakfast"] },
        { id: r2.id, mealTypes: ["lunch", "dinner"] },
      ]);
      expect(count).toBe(2);

      const [row1] = await tx
        .select()
        .from(communityRecipes)
        .where(eq(communityRecipes.id, r1.id));
      const [row2] = await tx
        .select()
        .from(communityRecipes)
        .where(eq(communityRecipes.id, r2.id));
      expect(row1.mealTypes).toEqual(["breakfast"]);
      expect(row2.mealTypes).toEqual(["lunch", "dinner"]);
    });

    it("refreshes the search index for entries already in the document store", async () => {
      const recipe = await createTestRecipe(testUser.id, { mealTypes: [] });
      mockDocumentStore.set(`community:${recipe.id}`, {
        id: `community:${recipe.id}`,
        mealTypes: [],
      });
      vi.mocked(searchIndex.addToIndex).mockClear();

      await batchUpdateCommunityMealTypes([
        { id: recipe.id, mealTypes: ["snack"] },
      ]);

      expect(searchIndex.addToIndex).toHaveBeenCalledWith(
        expect.objectContaining({ mealTypes: ["snack"] }),
      );
    });
  });
});
