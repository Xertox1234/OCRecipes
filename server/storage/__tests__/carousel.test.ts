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

// Mock the db import so the storage functions use our test transaction
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Import after mocking
const {
  getDismissedRecipeIds,
  getRecentDismissedRecipeIds,
  dismissRecipe,
  getRecentCommunityRecipes,
} = await import("../carousel");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

/** Insert a public community recipe. */
async function createPublicCommunityRecipe(
  authorId: string,
  overrides: Record<string, unknown> = {},
): Promise<schema.CommunityRecipe> {
  const [recipe] = await tx
    .insert(communityRecipes)
    .values({
      authorId,
      title: "Test Recipe",
      normalizedProductName: `test-${crypto.randomUUID()}`,
      instructions: ["Step 1"],
      isPublic: true,
      imageUrl: "https://example.com/image.jpg",
      ...overrides,
    })
    .returning();
  return recipe;
}

describe("carousel storage", () => {
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

  // --------------------------------------------------------------------------
  // getDismissedRecipeIds
  // --------------------------------------------------------------------------
  describe("getDismissedRecipeIds", () => {
    it("returns empty Set when no dismissals exist", async () => {
      const result = await getDismissedRecipeIds(testUser.id);
      expect(result).toBeInstanceOf(Set);
      expect(result.size).toBe(0);
    });

    it("returns dismissed recipe IDs as a Set of numbers", async () => {
      const recipe = await createPublicCommunityRecipe(testUser.id);
      await dismissRecipe(testUser.id, recipe.id);

      const result = await getDismissedRecipeIds(testUser.id);
      expect(result.has(recipe.id)).toBe(true);
    });

    it("does not include dismissals from another user", async () => {
      const otherUser = await createTestUser(tx);
      const recipe = await createPublicCommunityRecipe(testUser.id);
      await dismissRecipe(otherUser.id, recipe.id);

      const result = await getDismissedRecipeIds(testUser.id);
      expect(result.has(recipe.id)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // getRecentDismissedRecipeIds
  // --------------------------------------------------------------------------
  describe("getRecentDismissedRecipeIds", () => {
    it("returns empty array when no dismissals exist", async () => {
      const result = await getRecentDismissedRecipeIds(testUser.id);
      expect(result).toEqual([]);
    });

    it("returns an ordered list of recently dismissed IDs", async () => {
      const recipe1 = await createPublicCommunityRecipe(testUser.id, {
        title: "Recipe 1",
      });
      const recipe2 = await createPublicCommunityRecipe(testUser.id, {
        title: "Recipe 2",
      });
      await dismissRecipe(testUser.id, recipe1.id);
      await dismissRecipe(testUser.id, recipe2.id);

      const result = await getRecentDismissedRecipeIds(testUser.id);
      expect(result).toHaveLength(2);
      expect(result).toContain(recipe1.id);
      expect(result).toContain(recipe2.id);
    });

    it("respects the limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        const recipe = await createPublicCommunityRecipe(testUser.id, {
          title: `Recipe ${i}`,
        });
        await dismissRecipe(testUser.id, recipe.id);
      }

      const result = await getRecentDismissedRecipeIds(testUser.id, 3);
      expect(result).toHaveLength(3);
    });
  });

  // --------------------------------------------------------------------------
  // dismissRecipe
  // --------------------------------------------------------------------------
  describe("dismissRecipe", () => {
    it("creates a dismissal record without throwing", async () => {
      const recipe = await createPublicCommunityRecipe(testUser.id);

      await expect(
        dismissRecipe(testUser.id, recipe.id),
      ).resolves.not.toThrow();

      const ids = await getDismissedRecipeIds(testUser.id);
      expect(ids.has(recipe.id)).toBe(true);
    });

    it("is idempotent — duplicate dismissal is silently ignored", async () => {
      const recipe = await createPublicCommunityRecipe(testUser.id);
      await dismissRecipe(testUser.id, recipe.id);

      await expect(
        dismissRecipe(testUser.id, recipe.id),
      ).resolves.not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // getRecentCommunityRecipes
  // --------------------------------------------------------------------------
  describe("getRecentCommunityRecipes", () => {
    it("returns empty array when no public recipes exist", async () => {
      const result = await getRecentCommunityRecipes(testUser.id, {});
      expect(result).toEqual([]);
    });

    it("returns public recipes with an imageUrl", async () => {
      await createPublicCommunityRecipe(testUser.id, {
        title: "Public With Image",
      });

      const result = await getRecentCommunityRecipes(testUser.id, {});
      expect(result.length).toBeGreaterThanOrEqual(1);
      // All returned recipes must have an imageUrl (the function filters isNotNull)
      for (const r of result) {
        expect(r.imageUrl).not.toBeNull();
      }
    });

    it("excludes private recipes", async () => {
      await tx.insert(communityRecipes).values({
        authorId: testUser.id,
        title: "Private Recipe",
        normalizedProductName: "test-private-no-image",
        instructions: ["Step 1"],
        isPublic: false,
        imageUrl: "https://example.com/image.jpg",
      });

      const result = await getRecentCommunityRecipes(testUser.id, {});
      const titles = result.map((r) => r.title);
      expect(titles).not.toContain("Private Recipe");
    });

    it("excludes dismissed recipes when dismissedIds is provided", async () => {
      const dismissed = await createPublicCommunityRecipe(testUser.id, {
        title: "Dismissed Recipe",
      });
      const undismissed = await createPublicCommunityRecipe(testUser.id, {
        title: "Undismissed Recipe",
      });

      const dismissedIds = new Set([dismissed.id]);
      const result = await getRecentCommunityRecipes(testUser.id, {
        dismissedIds,
      });

      const ids = result.map((r) => r.id);
      expect(ids).not.toContain(dismissed.id);
      expect(ids).toContain(undismissed.id);
    });

    it("respects the limit filter", async () => {
      for (let i = 0; i < 5; i++) {
        await createPublicCommunityRecipe(testUser.id, {
          title: `Bulk Recipe ${i}`,
        });
      }

      const result = await getRecentCommunityRecipes(testUser.id, { limit: 2 });
      expect(result).toHaveLength(2);
    });
  });
});
