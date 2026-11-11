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

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const { getEligibleForPromotion } = await import("../canonical-recipes");

let tx: NodePgDatabase<typeof schema>;
let allowed: schema.User;
let aiOff: schema.User;

type RecipeOverrides = Partial<typeof communityRecipes.$inferInsert>;

/** A recipe one cook session past the threshold, so popularity never excludes it. */
async function addRecipe(title: string, overrides: RecipeOverrides) {
  const [row] = await tx
    .insert(communityRecipes)
    .values({
      normalizedProductName: "test",
      title,
      instructions: ["Cook"],
      ingredients: [],
      popularityCookSessions: 1,
      popularityScore: 3,
      ...overrides,
    })
    .returning();
  return row;
}

async function eligibleTitles() {
  // Other rows may exist in the test database; look only at this test's.
  const rows = await getEligibleForPromotion(1000);
  return rows.map((r) => r.title).filter((t) => t.startsWith("m13 "));
}

// Privacy audit M13 — the promotion job sends a recipe to AI companies with no
// user action, so it may only pick recipes that are public and whose author
// allows AI sharing.
describe("getEligibleForPromotion: who may be sent to AI", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    allowed = await createTestUser(tx, { aiSharingAllowedAt: new Date() });
    aiOff = await createTestUser(tx);
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("picks a public recipe whose author allows AI sharing", async () => {
    await addRecipe("m13 public allowed", { authorId: allowed.id });
    expect(await eligibleTitles()).toEqual(["m13 public allowed"]);
  });

  it("skips a private recipe even when its author allows AI sharing", async () => {
    await addRecipe("m13 private allowed", {
      authorId: allowed.id,
      isPublic: false,
    });
    expect(await eligibleTitles()).toEqual([]);
  });

  it("skips a public recipe whose author has AI sharing off", async () => {
    await addRecipe("m13 public ai off", { authorId: aiOff.id });
    expect(await eligibleTitles()).toEqual([]);
  });

  it("picks a public recipe with no author (platform content)", async () => {
    await addRecipe("m13 public platform", { authorId: null });
    expect(await eligibleTitles()).toEqual(["m13 public platform"]);
  });

  it("skips a private recipe with no author", async () => {
    await addRecipe("m13 private platform", {
      authorId: null,
      isPublic: false,
    });
    expect(await eligibleTitles()).toEqual([]);
  });

  it("does not retry enrichment for a canonical recipe whose author has AI sharing off", async () => {
    await addRecipe("m13 canonical ai off", {
      authorId: aiOff.id,
      isCanonical: true,
      canonicalEnrichedAt: null,
    });
    await addRecipe("m13 canonical private", {
      authorId: allowed.id,
      isPublic: false,
      isCanonical: true,
      canonicalEnrichedAt: null,
    });
    await addRecipe("m13 canonical allowed", {
      authorId: allowed.id,
      isCanonical: true,
      canonicalEnrichedAt: null,
    });
    expect(await eligibleTitles()).toEqual(["m13 canonical allowed"]);
  });
});
