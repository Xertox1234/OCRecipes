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

const {
  createInspiredSuggestions,
  getInspiredSuggestions,
  getInspiredSuggestion,
  setInspiredSuggestionImage,
  startMakingSuggestion,
  abandonMakingSuggestion,
  claimInspiredSuggestionMade,
  listExpiredUnmadeSuggestions,
  deleteInspiredSuggestions,
} = await import("../inspired-suggestions");

let tx: NodePgDatabase<typeof schema>;
let a: string;
let b: string;

const draft = (title: string) => ({
  title,
  description: "A quick and bright weeknight dish.",
  totalMinutes: 20,
  tags: ["quick"],
});
const tomorrow = () => new Date(Date.now() + 86_400_000);

async function seedCommunityRecipe(authorId: string) {
  const [recipe] = await tx
    .insert(communityRecipes)
    .values({
      authorId,
      title: "R",
      normalizedProductName: `test-product-${crypto.randomUUID().slice(0, 8)}`,
      instructions: ["Step 1"],
      isPublic: true,
    })
    .returning();
  return recipe;
}

beforeEach(async () => {
  tx = await setupTestTransaction();
  a = (await createTestUser(tx)).id;
  b = (await createTestUser(tx)).id;
});

afterEach(async () => {
  await rollbackTestTransaction();
});

afterAll(async () => {
  await closeTestPool();
});

describe("inspired suggestions storage", () => {
  it("creates rows and reads them back owner-scoped", async () => {
    const rows = await createInspiredSuggestions(
      a,
      [draft("One"), draft("Two")],
      tomorrow(),
    );
    expect(rows).toHaveLength(2);
    const ids = rows.map((r) => r.id);
    expect(await getInspiredSuggestions(a, ids)).toHaveLength(2);
    expect(await getInspiredSuggestions(b, ids)).toHaveLength(0);
    expect(await getInspiredSuggestion(b, ids[0])).toBeUndefined();
  });

  it("sets the image only once", async () => {
    const [row] = await createInspiredSuggestions(
      a,
      [draft("One")],
      tomorrow(),
    );
    expect(await setInspiredSuggestionImage(row.id, "u1")).toBe(true);
    expect(await setInspiredSuggestionImage(row.id, "u2")).toBe(false);
    expect((await getInspiredSuggestion(a, row.id))?.imageUrl).toBe("u1");
  });

  it("claims made only once, and only for the owner", async () => {
    const [row] = await createInspiredSuggestions(
      a,
      [draft("One")],
      tomorrow(),
    );
    const recipe = await seedCommunityRecipe(a);
    expect(await claimInspiredSuggestionMade(b, row.id, recipe.id)).toBe(false);
    expect(await claimInspiredSuggestionMade(a, row.id, recipe.id)).toBe(true);
    expect(await claimInspiredSuggestionMade(a, row.id, recipe.id)).toBe(false);
  });

  it("lets only one tap start making; a stale start can be retaken", async () => {
    const [row] = await createInspiredSuggestions(
      a,
      [draft("One")],
      tomorrow(),
    );
    expect(await startMakingSuggestion(b, row.id, 120_000)).toBe(false);
    expect(await startMakingSuggestion(a, row.id, 120_000)).toBe(true);
    expect(await startMakingSuggestion(a, row.id, 120_000)).toBe(false);
    expect(await startMakingSuggestion(a, row.id, 0)).toBe(true); // stale after 0 ms
    await abandonMakingSuggestion(row.id);
    expect(await startMakingSuggestion(a, row.id, 120_000)).toBe(true);
  });

  it("lists only expired, unmade rows", async () => {
    const past = new Date(Date.now() - 1000);
    const [expired] = await createInspiredSuggestions(a, [draft("Old")], past);
    await createInspiredSuggestions(a, [draft("Fresh")], tomorrow());
    const listed = await listExpiredUnmadeSuggestions(new Date(), 100);
    expect(listed.map((r) => r.id)).toEqual([expired.id]);
    expect(await deleteInspiredSuggestions([expired.id])).toBe(1);
  });
});
