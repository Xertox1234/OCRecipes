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
import { communityRecipes } from "@shared/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const { getRecentCommunityRecipes } = await import("../carousel");

let tx: NodePgDatabase<typeof schema>;
let testUserId: string;

async function createCommunityRecipe(overrides: Record<string, unknown> = {}) {
  const [recipe] = await tx
    .insert(communityRecipes)
    .values({
      authorId: testUserId,
      title: "Test Recipe",
      normalizedProductName: `test-product-${crypto.randomUUID().slice(0, 8)}`,
      instructions: ["Step 1"],
      isPublic: true,
      imageUrl: "https://example.com/image.jpg",
      dietTags: [],
      ...overrides,
    })
    .returning();
  return recipe;
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

describe("getRecentCommunityRecipes", () => {
  // Note: getRecentCommunityRecipes returns ALL public community recipes (not
  // user-scoped) and the carousel COLUMNS projection omits authorId. Other
  // test files run in parallel and may have visible rows. So these tests pass
  // a large `limit` to guarantee our inserted rows appear, then assert on
  // ordering by tracking our own IDs.

  it("orders by createdAt desc when no cuisinePreferences provided", async () => {
    // Postgres CURRENT_TIMESTAMP is fixed at transaction start, so explicit
    // createdAt values are needed to distinguish recipes within one tx.
    const baseTime = Date.now();
    const older = await createCommunityRecipe({
      title: "OrderOlder",
      createdAt: new Date(baseTime - 60_000),
    });
    const newer = await createCommunityRecipe({
      title: "OrderNewer",
      createdAt: new Date(baseTime),
    });

    const rows = await getRecentCommunityRecipes(testUserId, { limit: 1000 });
    const idsInOrder = rows
      .map((r) => r.id)
      .filter((id) => id === older.id || id === newer.id);

    expect(idsInOrder).toEqual([newer.id, older.id]);
  });

  it("excludes recipes without images", async () => {
    const withImage = await createCommunityRecipe({ title: "WithImage" });
    const noImage = await createCommunityRecipe({
      title: "NoImage",
      imageUrl: null,
    });

    const rows = await getRecentCommunityRecipes(testUserId, { limit: 1000 });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(withImage.id);
    expect(ids).not.toContain(noImage.id);
  });

  it("excludes non-public recipes", async () => {
    const pub = await createCommunityRecipe({ title: "Public" });
    const priv = await createCommunityRecipe({
      title: "Private",
      isPublic: false,
    });

    const rows = await getRecentCommunityRecipes(testUserId, { limit: 1000 });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(pub.id);
    expect(ids).not.toContain(priv.id);
  });

  it("boosts recipes whose dietTags overlap user cuisinePreferences to the top", async () => {
    // Italian-tagged is older (created first) — without boost, it would sort
    // after the newer non-match. Boost should push it to the top.
    const baseTime = Date.now();
    const italianMatch = await createCommunityRecipe({
      title: "Lasagna",
      dietTags: ["italian"],
      createdAt: new Date(baseTime - 60_000),
    });
    const nonMatch = await createCommunityRecipe({
      title: "Beef Stew",
      dietTags: ["american"],
      createdAt: new Date(baseTime),
    });

    const rows = await getRecentCommunityRecipes(testUserId, {
      cuisinePreferences: ["italian"],
      limit: 1000,
    });

    const idsInOrder = rows
      .map((r) => r.id)
      .filter((id) => id === italianMatch.id || id === nonMatch.id);
    // Italian match boosted to before non-match despite being older
    expect(idsInOrder).toEqual([italianMatch.id, nonMatch.id]);
  });

  it("matches cuisinePreferences case-insensitively", async () => {
    const baseTime = Date.now();
    const italianMatch = await createCommunityRecipe({
      title: "Lasagna",
      dietTags: ["italian"],
      createdAt: new Date(baseTime - 60_000),
    });
    const nonMatch = await createCommunityRecipe({
      title: "Beef Stew",
      dietTags: ["american"],
      createdAt: new Date(baseTime),
    });

    // User stored "Italian" with capital I (cuisineOrigin path)
    const rows = await getRecentCommunityRecipes(testUserId, {
      cuisinePreferences: ["Italian"],
      limit: 1000,
    });

    const idsInOrder = rows
      .map((r) => r.id)
      .filter((id) => id === italianMatch.id || id === nonMatch.id);
    expect(idsInOrder).toEqual([italianMatch.id, nonMatch.id]);
  });

  it("returns all recipes (boost, not filter) when no recent recipes match cuisinePreferences", async () => {
    const a = await createCommunityRecipe({
      title: "A",
      dietTags: ["american"],
    });
    const b = await createCommunityRecipe({
      title: "B",
      dietTags: ["french"],
    });

    const rows = await getRecentCommunityRecipes(testUserId, {
      cuisinePreferences: ["italian"],
      limit: 1000,
    });

    // Neither matches "italian" but both should still be returned (boost, not filter)
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
  });

  it("handles empty cuisinePreferences array by falling back to recency ordering", async () => {
    const baseTime = Date.now();
    const older = await createCommunityRecipe({
      title: "EmptyOlder",
      createdAt: new Date(baseTime - 60_000),
    });
    const newer = await createCommunityRecipe({
      title: "EmptyNewer",
      createdAt: new Date(baseTime),
    });

    const rows = await getRecentCommunityRecipes(testUserId, {
      cuisinePreferences: [],
      limit: 1000,
    });

    const idsInOrder = rows
      .map((r) => r.id)
      .filter((id) => id === older.id || id === newer.id);
    expect(idsInOrder).toEqual([newer.id, older.id]);
  });

  it("excludes dismissed recipe IDs", async () => {
    const keep = await createCommunityRecipe({ title: "Keep" });
    const drop = await createCommunityRecipe({ title: "Drop" });

    const rows = await getRecentCommunityRecipes(testUserId, {
      dismissedIds: new Set([drop.id]),
      limit: 1000,
    });

    const ids = rows.map((r) => r.id);
    expect(ids).toContain(keep.id);
    expect(ids).not.toContain(drop.id);
  });
});
