import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";
import {
  communityRecipes,
  favouriteRecipes,
  recipeTries,
  users,
} from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  isPublicCommunityRecipe,
  setRecipeTried,
  getRecipeCommunityStats,
  getRecipeVariants,
} = await import("../recipe-tries");

let tx: NodePgDatabase<typeof schema>;
let author: schema.User;
let viewer: schema.User;

async function createCommunityRecipe(
  overrides: Record<string, unknown> = {},
): Promise<schema.CommunityRecipe> {
  const [recipe] = await tx
    .insert(communityRecipes)
    .values({
      authorId: author.id,
      title: "Test Community Recipe",
      // `test-` prefix: caught by global-teardown if a row leaks.
      normalizedProductName: "test-product",
      instructions: ["Step 1"],
      ...overrides,
    })
    .returning();
  return recipe;
}

describe("recipe-tries storage", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    author = await createTestUser(tx);
    viewer = await createTestUser(tx);
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  describe("isPublicCommunityRecipe", () => {
    it("is true only when isPublic = true", async () => {
      const pub = await createCommunityRecipe({ isPublic: true });
      const priv = await createCommunityRecipe({ isPublic: false });
      const nul = await createCommunityRecipe({ isPublic: null });
      expect(await isPublicCommunityRecipe(pub.id)).toBe(true);
      expect(await isPublicCommunityRecipe(priv.id)).toBe(false);
      expect(await isPublicCommunityRecipe(nul.id)).toBe(false);
    });

    it("is false for a missing id", async () => {
      expect(await isPublicCommunityRecipe(2_000_000_000)).toBe(false);
    });
  });

  describe("setRecipeTried + getRecipeCommunityStats", () => {
    it("starts at all zeros", async () => {
      const r = await createCommunityRecipe();
      expect(await getRecipeCommunityStats(r.id, viewer.id)).toEqual({
        triedCount: 0,
        triedByMe: false,
        favouritedCount: 0,
        variantCount: 0,
      });
    });

    it("marking twice counts once", async () => {
      const r = await createCommunityRecipe();
      await setRecipeTried(viewer.id, r.id, true);
      await setRecipeTried(viewer.id, r.id, true);
      const stats = await getRecipeCommunityStats(r.id, viewer.id);
      expect(stats.triedCount).toBe(1);
      expect(stats.triedByMe).toBe(true);
    });

    it("triedByMe is per-user", async () => {
      const r = await createCommunityRecipe();
      await setRecipeTried(author.id, r.id, true);
      const stats = await getRecipeCommunityStats(r.id, viewer.id);
      expect(stats.triedCount).toBe(1);
      expect(stats.triedByMe).toBe(false);
    });

    it("unmarking removes the row; unmarking again is a no-op", async () => {
      const r = await createCommunityRecipe();
      await setRecipeTried(viewer.id, r.id, true);
      await setRecipeTried(viewer.id, r.id, false);
      await setRecipeTried(viewer.id, r.id, false);
      const stats = await getRecipeCommunityStats(r.id, viewer.id);
      expect(stats.triedCount).toBe(0);
      expect(stats.triedByMe).toBe(false);
    });

    it("favouritedCount counts current community favourites only", async () => {
      const r = await createCommunityRecipe();
      await tx.insert(favouriteRecipes).values([
        { userId: viewer.id, recipeId: r.id, recipeType: "community" },
        { userId: author.id, recipeId: r.id, recipeType: "community" },
      ]);
      // Same numeric id, but a meal-plan favourite — must NOT count.
      // (favourite_recipes.recipe_id has no FK, so no meal-plan row is needed.)
      await tx.insert(favouriteRecipes).values({
        userId: viewer.id,
        recipeId: r.id,
        recipeType: "mealPlan",
      });
      // Unfavourite one community favourite.
      await tx
        .delete(favouriteRecipes)
        .where(
          and(
            eq(favouriteRecipes.userId, author.id),
            eq(favouriteRecipes.recipeType, "community"),
          ),
        );
      const stats = await getRecipeCommunityStats(r.id, viewer.id);
      expect(stats.favouritedCount).toBe(1);
    });

    it("variantCount counts public remixes only (false and NULL excluded)", async () => {
      const r = await createCommunityRecipe();
      await createCommunityRecipe({ remixedFromId: r.id, isPublic: true });
      await createCommunityRecipe({ remixedFromId: r.id, isPublic: false });
      await createCommunityRecipe({ remixedFromId: r.id, isPublic: null });
      const stats = await getRecipeCommunityStats(r.id, viewer.id);
      expect(stats.variantCount).toBe(1);
    });
  });

  describe("cascades", () => {
    it("deleting the user removes their tries", async () => {
      const r = await createCommunityRecipe();
      await setRecipeTried(viewer.id, r.id, true);
      await tx.delete(users).where(eq(users.id, viewer.id));
      const stats = await getRecipeCommunityStats(r.id, author.id);
      expect(stats.triedCount).toBe(0);
    });

    it("deleting the recipe removes its tries", async () => {
      const r = await createCommunityRecipe();
      await setRecipeTried(viewer.id, r.id, true);
      await tx.delete(communityRecipes).where(eq(communityRecipes.id, r.id));
      const rows = await tx
        .select()
        .from(recipeTries)
        .where(eq(recipeTries.recipeId, r.id));
      expect(rows).toHaveLength(0);
    });
  });

  describe("getRecipeVariants", () => {
    it("returns public remixes newest first, without author", async () => {
      const r = await createCommunityRecipe();
      const older = await createCommunityRecipe({
        remixedFromId: r.id,
        title: "Older",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
      const newer = await createCommunityRecipe({
        remixedFromId: r.id,
        title: "Newer",
        createdAt: new Date("2026-02-01T00:00:00Z"),
      });
      await createCommunityRecipe({ remixedFromId: r.id, isPublic: false });
      await createCommunityRecipe({ remixedFromId: r.id, isPublic: null });

      const variants = await getRecipeVariants(r.id);
      expect(variants.map((v) => v.id)).toEqual([newer.id, older.id]);
      expect(Object.keys(variants[0]).sort()).toEqual(
        ["createdAt", "id", "imageUrl", "title"].sort(),
      );
    });

    it("respects the limit", async () => {
      const r = await createCommunityRecipe();
      await createCommunityRecipe({ remixedFromId: r.id });
      await createCommunityRecipe({ remixedFromId: r.id });
      expect(await getRecipeVariants(r.id, 1)).toHaveLength(1);
    });
  });

  describe("data export", () => {
    it("includes the user's tries (recipeId + createdAt only)", async () => {
      const { getUserDataExport } = await import("../export");
      const r = await createCommunityRecipe();
      await setRecipeTried(viewer.id, r.id, true);
      await setRecipeTried(author.id, r.id, true);

      const data = await getUserDataExport(viewer.id);
      expect(data.recipeTries).toHaveLength(1);
      expect(data.recipeTries[0]).toEqual({
        recipeId: r.id,
        createdAt: expect.any(Date),
      });
    });
  });
});
