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
import { communityRecipes, inspiredSuggestions } from "@shared/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  createInspiredSuggestions,
  countInspiredSuggestionsSince,
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

  it("counts only the user's own rows created since the cutoff", async () => {
    const mine = await createInspiredSuggestions(
      a,
      [draft("One"), draft("Two"), draft("Old")],
      tomorrow(),
    );
    await createInspiredSuggestions(b, [draft("Theirs")], tomorrow());
    await tx
      .update(inspiredSuggestions)
      .set({ createdAt: new Date(Date.now() - 2 * 86_400_000) })
      .where(eq(inspiredSuggestions.id, mine[2].id));
    const since = new Date(Date.now() - 86_400_000);
    expect(await countInspiredSuggestionsSince(a, since)).toBe(2);
    expect(await countInspiredSuggestionsSince(b, since)).toBe(1);
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

  it("never attaches a late image to a made card", async () => {
    const [row] = await createInspiredSuggestions(
      a,
      [draft("One")],
      tomorrow(),
    );
    const recipe = await seedCommunityRecipe(a);
    expect(await claimInspiredSuggestionMade(a, row.id, recipe.id)).toBe(true);
    expect(await setInspiredSuggestionImage(row.id, "late")).toBe(false);
    expect((await getInspiredSuggestion(a, row.id))?.imageUrl).toBeNull();
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
    expect(await startMakingSuggestion(b, row.id, 120_000)).toBeNull();
    const first = await startMakingSuggestion(a, row.id, 120_000);
    expect(first).toBeInstanceOf(Date);
    expect(await startMakingSuggestion(a, row.id, 120_000)).toBeNull();
    const second = await startMakingSuggestion(a, row.id, 0); // stale after 0 ms
    expect(second).toBeInstanceOf(Date);
    // the correct holder's abandon DOES clear (proves timestamp equality matches)
    await abandonMakingSuggestion(row.id, second!);
    expect(await startMakingSuggestion(a, row.id, 120_000)).toBeInstanceOf(
      Date,
    );
  });

  it("a displaced holder's abandon does not clear the new holder's lock", async () => {
    const [row] = await createInspiredSuggestions(
      a,
      [draft("One")],
      tomorrow(),
    );
    const first = await startMakingSuggestion(a, row.id, 120_000);
    await new Promise((r) => setTimeout(r, 5));
    const second = await startMakingSuggestion(a, row.id, 0);
    expect(second).not.toBeNull();
    expect(second!.getTime()).not.toBe(first!.getTime());
    await abandonMakingSuggestion(row.id, first!);
    expect(await startMakingSuggestion(a, row.id, 120_000)).toBeNull();
  });

  it("does not start making once the card is made, even with staleAfterMs 0", async () => {
    const [row] = await createInspiredSuggestions(
      a,
      [draft("One")],
      tomorrow(),
    );
    const recipe = await seedCommunityRecipe(a);
    await claimInspiredSuggestionMade(a, row.id, recipe.id);
    expect(await startMakingSuggestion(a, row.id, 0)).toBeNull();
  });

  it("lists only expired, unmade rows", async () => {
    const past = new Date(Date.now() - 1000);
    const [expired] = await createInspiredSuggestions(a, [draft("Old")], past);
    await createInspiredSuggestions(a, [draft("Fresh")], tomorrow());
    const listed = await listExpiredUnmadeSuggestions(new Date(), 100);
    expect(listed.map((r) => r.id)).toEqual([expired.id]);
    expect(
      (await deleteInspiredSuggestions([expired.id])).map((r) => r.id),
    ).toEqual([expired.id]);
  });

  it("never lists or deletes a claimed card, even if expired", async () => {
    const [row] = await createInspiredSuggestions(
      a,
      [draft("Old")],
      new Date(Date.now() - 1000),
    );
    const recipe = await seedCommunityRecipe(a);
    await claimInspiredSuggestionMade(a, row.id, recipe.id);
    expect(await listExpiredUnmadeSuggestions(new Date(), 100)).toEqual([]);
    expect(await deleteInspiredSuggestions([row.id])).toEqual([]);
    expect(await getInspiredSuggestion(a, row.id)).toBeDefined();
  });
});
