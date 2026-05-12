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
import { communityRecipes, userProfiles } from "@shared/schema";
import { logger } from "../../lib/logger";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const { getTastePicks, setTastePicks, getTastePickCandidates } = await import(
  "../taste-picks"
);

let tx: NodePgDatabase<typeof schema>;
let testUserId: string;

async function createCommunityRecipe(overrides: Record<string, unknown> = {}) {
  const [recipe] = await tx
    .insert(communityRecipes)
    .values({
      authorId: testUserId,
      title: "Test Recipe",
      normalizedProductName: "test-product",
      instructions: ["Step 1"],
      isPublic: true,
      imageUrl: "https://example.com/image.jpg",
      cuisineOrigin: "Italian",
      ...overrides,
    })
    .returning();
  return recipe;
}

async function createProfile(cuisinePreferences: string[] = []) {
  await tx.insert(userProfiles).values({
    userId: testUserId,
    cuisinePreferences,
  });
}

beforeEach(async () => {
  tx = await setupTestTransaction();
  const user = await createTestUser(tx);
  testUserId = user.id;
});

afterEach(async () => {
  await rollbackTestTransaction();
});

afterAll(async () => {
  await closeTestPool();
});

describe("getTastePicks", () => {
  it("returns empty array when user has no picks", async () => {
    const picks = await getTastePicks(testUserId);
    expect(picks).toEqual([]);
  });

  it("returns picks with recipe info", async () => {
    await createProfile();
    const recipe = await createCommunityRecipe({
      title: "Pasta",
      cuisineOrigin: "Italian",
    });
    await setTastePicks(testUserId, [recipe.id]);

    const picks = await getTastePicks(testUserId);
    expect(picks).toHaveLength(1);
    expect(picks[0].recipeId).toBe(recipe.id);
    expect(picks[0].title).toBe("Pasta");
    expect(picks[0].cuisineOrigin).toBe("Italian");
  });

  it("excludes private recipes from read path (isPublic guard)", async () => {
    await createProfile();
    const publicRecipe = await createCommunityRecipe({ title: "Public Pasta" });
    const privateRecipe = await createCommunityRecipe({
      title: "Private Pasta",
      isPublic: false,
      normalizedProductName: "test-private-read",
    });
    // Directly insert a pick for the private recipe to simulate a stale row
    const { tastePicks: picksTable } = await import("@shared/schema");
    const { getTestTx: getTx } = await import("../../../test/db-test-utils");
    await getTx()
      .insert(picksTable)
      .values([
        { userId: testUserId, recipeId: publicRecipe.id },
        { userId: testUserId, recipeId: privateRecipe.id },
      ]);

    const picks = await getTastePicks(testUserId);
    const titles = picks.map((p) => p.title);
    expect(titles).toContain("Public Pasta");
    expect(titles).not.toContain("Private Pasta");
  });
});

describe("setTastePicks", () => {
  it("inserts new picks", async () => {
    await createProfile();
    const recipe = await createCommunityRecipe();
    await setTastePicks(testUserId, [recipe.id]);

    const picks = await getTastePicks(testUserId);
    expect(picks).toHaveLength(1);
  });

  it("is idempotent — re-setting same IDs yields same rows", async () => {
    await createProfile();
    const recipe = await createCommunityRecipe();
    await setTastePicks(testUserId, [recipe.id]);
    await setTastePicks(testUserId, [recipe.id]);

    const picks = await getTastePicks(testUserId);
    expect(picks).toHaveLength(1);
  });

  it("removes IDs not in the new set", async () => {
    await createProfile();
    const r1 = await createCommunityRecipe({
      title: "A",
      normalizedProductName: "test-a",
    });
    const r2 = await createCommunityRecipe({
      title: "B",
      normalizedProductName: "test-b",
    });
    await setTastePicks(testUserId, [r1.id, r2.id]);
    await setTastePicks(testUserId, [r1.id]);

    const picks = await getTastePicks(testUserId);
    expect(picks).toHaveLength(1);
    expect(picks[0].recipeId).toBe(r1.id);
  });

  it("handles empty array — removes all picks", async () => {
    await createProfile();
    const recipe = await createCommunityRecipe();
    await setTastePicks(testUserId, [recipe.id]);
    await setTastePicks(testUserId, []);

    const picks = await getTastePicks(testUserId);
    expect(picks).toHaveLength(0);
  });

  it("write-through: merges cuisineOrigin into profile.cuisinePreferences", async () => {
    // Pre-existing manual cuisines keep their original casing; derived
    // cuisines from picks are normalized to lowercase so the carousel boost
    // SQL and generateCommunityReason can match without re-normalizing.
    await createProfile(["Mexican"]);
    const recipe = await createCommunityRecipe({ cuisineOrigin: "Italian" });
    const result = await setTastePicks(testUserId, [recipe.id]);

    expect(result.cuisinePreferences).toContain("italian");
    expect(result.cuisinePreferences).toContain("Mexican");
  });

  it("write-through: does not remove pre-existing manual cuisines", async () => {
    await createProfile(["French"]);
    const recipe = await createCommunityRecipe({ cuisineOrigin: "Italian" });
    await setTastePicks(testUserId, [recipe.id]);
    const result = await setTastePicks(testUserId, []);

    // French was set manually before picks existed — it stays
    expect(result.cuisinePreferences).toContain("French");
  });

  it("write-through: null cuisineOrigin recipes do not add empty string", async () => {
    await createProfile([]);
    const recipe = await createCommunityRecipe({ cuisineOrigin: null });
    const result = await setTastePicks(testUserId, [recipe.id]);

    expect(result.cuisinePreferences).not.toContain(null);
    expect(result.cuisinePreferences).not.toContain("");
  });

  it("dedupes duplicate recipeIds before insert (no unique-constraint crash)", async () => {
    // The isPublic SELECT pre-filter naturally dedupes via the recipes
    // PK, but this test pins the contract — duplicates in the caller's
    // array must not surface a unique-constraint error.
    await createProfile();
    const recipe = await createCommunityRecipe();

    await expect(
      setTastePicks(testUserId, [recipe.id, recipe.id, recipe.id]),
    ).resolves.toBeDefined();

    const picks = await getTastePicks(testUserId);
    expect(picks).toHaveLength(1);
    expect(picks[0].recipeId).toBe(recipe.id);
  });

  it("logs warn when no profile row exists but derived cuisines are non-empty", async () => {
    // L3 fix: surface the silently-skipped cuisine merge when a user has
    // taste picks but no userProfiles row yet (e.g. mid-onboarding race).
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => logger);

    // Intentionally do NOT create a profile row.
    const recipe = await createCommunityRecipe({ cuisineOrigin: "Italian" });
    await setTastePicks(testUserId, [recipe.id]);

    const noProfileWarn = warnSpy.mock.calls.find(
      ([, msg]) =>
        typeof msg === "string" &&
        msg.includes("no profile row, cuisine merge skipped"),
    );
    expect(noProfileWarn).toBeDefined();

    warnSpy.mockRestore();
  });

  it("silently ignores private recipeIds — does not insert them", async () => {
    await createProfile([]);
    const privateRecipe = await createCommunityRecipe({
      isPublic: false,
      normalizedProductName: "test-private-set",
    });
    const result = await setTastePicks(testUserId, [privateRecipe.id]);

    expect(result.picks).toHaveLength(0);
  });

  it("with mixed public/private IDs, only inserts public ones and excludes private cuisine", async () => {
    await createProfile([]);
    const publicRecipe = await createCommunityRecipe({
      title: "Public",
      cuisineOrigin: "Japanese",
      normalizedProductName: "test-public-mix",
    });
    const privateRecipe = await createCommunityRecipe({
      title: "Private",
      isPublic: false,
      cuisineOrigin: "Korean",
      normalizedProductName: "test-private-mix",
    });
    const result = await setTastePicks(testUserId, [
      publicRecipe.id,
      privateRecipe.id,
    ]);

    expect(result.picks).toHaveLength(1);
    expect(result.picks[0].recipeId).toBe(publicRecipe.id);
    // Derived cuisines are lowercased (see setTastePicks).
    expect(result.cuisinePreferences).toContain("japanese");
    expect(result.cuisinePreferences).not.toContain("korean");
  });
});

describe("getTastePickCandidates", () => {
  it("returns only public recipes with images", async () => {
    await createCommunityRecipe({
      title: "Public",
      isPublic: true,
      imageUrl: "https://example.com/1.jpg",
    });
    await createCommunityRecipe({
      title: "Private",
      isPublic: false,
      imageUrl: "https://example.com/2.jpg",
      normalizedProductName: "test-private",
    });
    await createCommunityRecipe({
      title: "No Image",
      isPublic: true,
      imageUrl: null,
      normalizedProductName: "test-no-image",
    });

    const result = await getTastePickCandidates({ page: 1, limit: 100 });
    const titles = result.candidates.map((c) => c.title);
    expect(titles).toContain("Public");
    expect(titles).not.toContain("Private");
    expect(titles).not.toContain("No Image");
  });

  it("filters by dietType when provided", async () => {
    await createCommunityRecipe({
      title: "Vegan Dish",
      normalizedProductName: "test-vegan",
      dietTags: ["vegan"],
    });
    await createCommunityRecipe({
      title: "Meat Dish",
      normalizedProductName: "test-meat",
      dietTags: [],
    });

    const result = await getTastePickCandidates({
      page: 1,
      limit: 100,
      dietType: "vegan",
    });
    const titles = result.candidates.map((c) => c.title);
    expect(titles).toContain("Vegan Dish");
    expect(titles).not.toContain("Meat Dish");
  });

  it("returns paginated results", async () => {
    for (let i = 0; i < 5; i++) {
      await createCommunityRecipe({
        title: `Recipe ${i}`,
        normalizedProductName: `test-recipe-${i}`,
        imageUrl: `https://example.com/${i}.jpg`,
      });
    }
    const page1 = await getTastePickCandidates({ page: 1, limit: 3 });
    expect(page1.candidates).toHaveLength(3);
    expect(page1.total).toBeGreaterThanOrEqual(5);
    expect(page1.page).toBe(1);
  });
});
