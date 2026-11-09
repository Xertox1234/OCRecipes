import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  createTestUserProfile,
  getTestTx,
} from "../../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import type { PlanCardPayload } from "@shared/schemas/coach-write-cards";
import { createMockCoachWriteCard } from "../../../__tests__/factories";

vi.mock("../../../db", () => ({
  get db() {
    return getTestTx();
  },
}));
const autoGenerateRecipeImage = vi.fn(async () => undefined);
const { addToIndex, removeFromIndex } = vi.hoisted(() => ({
  addToIndex: vi.fn(),
  removeFromIndex: vi.fn(),
}));
vi.mock("../../../lib/search-index", async (orig) => ({
  ...(await orig<typeof import("../../../lib/search-index")>()),
  addToIndex,
  removeFromIndex,
}));
vi.mock("../../recipe-auto-image", () => ({ autoGenerateRecipeImage }));

const {
  buildPlanPayload,
  performPlanSave,
  revertPlanSave,
  startPlanImageJobs,
  addMealPlanCardArgsSchema,
} = await import("../plan");
const { WriteCardEditError } = await import("../errors");

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;

async function community(
  title: string,
  opts: { isPublic?: boolean; authorId?: string; imageUrl?: string } = {},
) {
  const [r] = await tx
    .insert(schema.communityRecipes)
    .values({
      title,
      normalizedProductName: title.toLowerCase(),
      instructions: ["Cook it."],
      ingredients: [
        { name: "Chickpeas", quantity: "1", unit: "can" },
        { name: "Spinach", quantity: "1", unit: "bag" },
      ],
      caloriesPerServing: "500",
      proteinPerServing: "40",
      mealTypes: ["dinner"],
      isPublic: opts.isPublic ?? true,
      authorId: opts.authorId ?? null,
      imageUrl: opts.imageUrl ?? null,
    })
    .returning();
  return r;
}

async function mine(title: string) {
  const [r] = await tx
    .insert(schema.mealPlanRecipes)
    .values({
      userId: user.id,
      title,
      caloriesPerServing: "450",
      proteinPerServing: "35",
    })
    .returning();
  return r;
}

const planItems = () =>
  tx
    .select()
    .from(schema.mealPlanItems)
    .where(eq(schema.mealPlanItems.userId, user.id));

const liveRecipes = () =>
  tx
    .select()
    .from(schema.mealPlanRecipes)
    .where(
      and(
        eq(schema.mealPlanRecipes.userId, user.id),
        isNull(schema.mealPlanRecipes.deletedAt),
      ),
    );

const card = (
  p: PlanCardPayload,
  savedRefs: schema.CoachWriteCard["savedRefs"] = null,
) =>
  createMockCoachWriteCard({
    userId: user.id,
    kind: "plan",
    payload: p,
    savedRefs,
  });

describe("plan write card", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    user = await createTestUser(tx);
    autoGenerateRecipeImage.mockClear();
    addToIndex.mockClear();
    removeFromIndex.mockClear();
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("an invented recipe id is dropped and its first real alternative promoted", async () => {
    const real = await community("Turkey chili");
    const p = await buildPlanPayload(
      addMealPlanCardArgsSchema.parse({
        rows: [
          {
            plannedDate: "2026-11-09",
            mealType: "dinner",
            recipe: { source: "community", id: 999_999 },
            alternatives: [
              { source: "mine", id: 888_888 },
              { source: "community", id: real.id },
            ],
          },
        ],
      }),
      user.id,
    );
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].recipe).toMatchObject({
      source: "community",
      id: real.id,
      title: "Turkey chili",
    });
    expect(p.rows[0].alternatives).toEqual([]);
  });

  it("a row with nothing real left is dropped; no rows at all throws", async () => {
    await expect(
      buildPlanPayload(
        addMealPlanCardArgsSchema.parse({
          rows: [
            {
              plannedDate: "2026-11-09",
              mealType: "dinner",
              recipe: { source: "community", id: 999_999 },
              alternatives: [],
            },
          ],
        }),
        user.id,
      ),
    ).rejects.toBeInstanceOf(WriteCardEditError);
  });

  it("alternatives resolve server-side titles and skip another user's private recipe", async () => {
    const main = await community("Chicken shawarma bowl");
    const alt = await mine("My tofu stir-fry");
    const other = await createTestUser(tx);
    const privateOne = await community("Secret", {
      isPublic: false,
      authorId: other.id,
    });
    const p = await buildPlanPayload(
      addMealPlanCardArgsSchema.parse({
        rows: [
          {
            plannedDate: "2026-11-09",
            mealType: "dinner",
            recipe: { source: "community", id: main.id },
            alternatives: [
              { source: "mine", id: alt.id },
              { source: "community", id: privateOne.id },
            ],
          },
        ],
      }),
      user.id,
    );
    expect(p.rows[0].recipe).toEqual({
      source: "community",
      id: main.id,
      title: "Chicken shawarma bowl",
      calories: 500,
      protein: 40,
    });
    expect(p.rows[0].alternatives).toEqual([
      {
        source: "mine",
        id: alt.id,
        title: "My tofu stir-fry",
        calories: 450,
        protein: 35,
      },
    ]);
  });

  it("a community recipe unsafe for the user's allergies is dropped", async () => {
    await createTestUserProfile(tx, user.id, {
      allergies: [{ name: "peanuts", severity: "severe" }],
    });
    const unsafe = await community("Peanut noodles");
    await tx
      .update(schema.communityRecipes)
      .set({ allergens: [{ id: "peanuts", viaDerived: false }] })
      .where(eq(schema.communityRecipes.id, unsafe.id));
    const underived = await community("Never analysed");
    await tx
      .update(schema.communityRecipes)
      .set({ allergens: null })
      .where(eq(schema.communityRecipes.id, underived.id));
    const safe = await community("Chicken shawarma bowl");
    await tx
      .update(schema.communityRecipes)
      .set({ allergens: [] })
      .where(eq(schema.communityRecipes.id, safe.id));
    const p = await buildPlanPayload(
      addMealPlanCardArgsSchema.parse({
        rows: [
          {
            plannedDate: "2026-11-09",
            mealType: "dinner",
            recipe: { source: "community", id: unsafe.id },
            alternatives: [
              { source: "community", id: underived.id },
              { source: "community", id: safe.id },
            ],
          },
        ],
      }),
      user.id,
    );
    expect(p.rows[0].recipe.title).toBe("Chicken shawarma bowl");
    expect(p.rows[0].alternatives).toEqual([]);
  });

  it("tool args allow at most 3 alternatives and 7 rows", () => {
    const ref = { source: "community", id: 1 };
    const row = {
      plannedDate: "2026-11-09",
      mealType: "dinner",
      recipe: ref,
      alternatives: [ref, ref, ref, ref],
    };
    expect(addMealPlanCardArgsSchema.safeParse({ rows: [row] }).success).toBe(
      false,
    );
    expect(
      addMealPlanCardArgsSchema.safeParse({
        rows: Array(8).fill({ ...row, alternatives: [] }),
      }).success,
    ).toBe(false);
  });

  it("alreadyPlanned names the existing meal", async () => {
    const existing = await mine("Leftover curry");
    await tx.insert(schema.mealPlanItems).values({
      userId: user.id,
      recipeId: existing.id,
      plannedDate: "2026-11-09",
      mealType: "dinner",
    });
    const main = await community("Chicken shawarma bowl");
    const p = await buildPlanPayload(
      addMealPlanCardArgsSchema.parse({
        rows: [
          {
            plannedDate: "2026-11-09",
            mealType: "dinner",
            recipe: { source: "community", id: main.id },
            alternatives: [],
          },
          {
            plannedDate: "2026-11-10",
            mealType: "dinner",
            recipe: { source: "community", id: main.id },
            alternatives: [],
          },
        ],
      }),
      user.id,
    );
    expect(p.rows.map((r) => r.alreadyPlanned)).toEqual([
      "Leftover curry",
      null,
    ]);
  });

  async function twoRowPlan() {
    const shawarma = await community("Chicken shawarma bowl");
    const stew = await mine("Lentil stew");
    return buildPlanPayload(
      addMealPlanCardArgsSchema.parse({
        rows: [
          {
            plannedDate: "2026-11-09",
            mealType: "dinner",
            recipe: { source: "community", id: shawarma.id },
            alternatives: [],
          },
          {
            plannedDate: "2026-11-10",
            mealType: "dinner",
            recipe: { source: "mine", id: stew.id },
            alternatives: [],
          },
        ],
      }),
      user.id,
    );
  }

  it("save copies a community recipe and plans it", async () => {
    const p = await twoRowPlan();
    const refs = await performPlanSave(tx, card(p), {}, { userId: user.id });
    expect(refs.mealPlanItemIds).toHaveLength(2);
    expect(refs.copiedRecipeIds).toHaveLength(1);
    const recipes = await liveRecipes();
    const copy = recipes.find((r) => r.id === refs.copiedRecipeIds![0]);
    expect(copy).toMatchObject({
      title: "Chicken shawarma bowl",
      sourceType: "community_copy",
      caloriesPerServing: "500.00",
    });
    const items = await planItems();
    expect(
      items.map((i) => [i.plannedDate, i.mealType, i.recipeId]).sort(),
    ).toEqual(
      [
        ["2026-11-09", "dinner", copy!.id],
        [
          "2026-11-10",
          "dinner",
          recipes.find((r) => r.title === "Lentil stew")!.id,
        ],
      ].sort(),
    );
  });

  it("undo removes plan items and only the copies this save made", async () => {
    const p = await twoRowPlan();
    const refs = await performPlanSave(tx, card(p), {}, { userId: user.id });
    await revertPlanSave(tx, card(p, refs));
    expect(await planItems()).toHaveLength(0);
    expect((await liveRecipes()).map((r) => r.title)).toEqual(["Lentil stew"]);
  });

  it("a recipe that became unsafe after the card was built is refused at save", async () => {
    const p = await twoRowPlan(); // shawarma: community, allergens null
    await createTestUserProfile(tx, user.id, {
      allergies: [{ name: "peanuts", severity: "severe" }],
    });
    await expect(
      performPlanSave(tx, card(p), {}, { userId: user.id }),
    ).rejects.toBeInstanceOf(WriteCardEditError);
    expect(await planItems()).toHaveLength(0);
  });

  it("search-index updates wait until the save and the undo commit", async () => {
    const p = await twoRowPlan();
    const later: (() => void)[] = [];
    const afterCommit = (fn: () => void) => later.push(fn);
    const refs = await performPlanSave(
      tx,
      card(p),
      {},
      { userId: user.id, afterCommit },
    );
    expect(addToIndex).not.toHaveBeenCalled();
    later.splice(0).forEach((fn) => fn());
    expect(addToIndex).toHaveBeenCalledTimes(1);

    await revertPlanSave(tx, card(p, refs), afterCommit);
    expect(removeFromIndex).not.toHaveBeenCalled();
    later.splice(0).forEach((fn) => fn());
    expect(removeFromIndex).toHaveBeenCalledWith(
      `personal:${refs.copiedRecipeIds![0]}`,
    );
  });

  it("chosen index outside alternatives is rejected", async () => {
    const p = await twoRowPlan();
    await expect(
      performPlanSave(tx, card(p), { chosen: [2, null] }, { userId: user.id }),
    ).rejects.toBeInstanceOf(WriteCardEditError);
    expect(await planItems()).toHaveLength(0);
  });

  it("removing every row leaves nothing to save", async () => {
    const p = await twoRowPlan();
    await expect(
      performPlanSave(
        tx,
        card(p),
        { removed: [true, true] },
        { userId: user.id },
      ),
    ).rejects.toBeInstanceOf(WriteCardEditError);
  });

  it("addShopping puts ingredients on the shopping list minus pantry", async () => {
    const [list] = await tx
      .insert(schema.groceryLists)
      .values({
        userId: user.id,
        title: "Weekly shop",
        dateRangeStart: "2026-11-01",
        dateRangeEnd: "2026-11-07",
      })
      .returning();
    await tx
      .insert(schema.pantryItems)
      .values({ userId: user.id, name: "spinach", quantity: "5", unit: "bag" });
    const shawarma = await community("Chicken shawarma bowl");
    const p = await buildPlanPayload(
      addMealPlanCardArgsSchema.parse({
        rows: [
          {
            plannedDate: "2026-11-09",
            mealType: "dinner",
            recipe: { source: "community", id: shawarma.id },
            alternatives: [],
          },
        ],
      }),
      user.id,
    );
    expect(p.shoppingListId).toBe(list.id);
    const refs = await performPlanSave(
      tx,
      card(p),
      { addShopping: true },
      { userId: user.id },
    );
    const rows = await tx
      .select()
      .from(schema.groceryListItems)
      .where(eq(schema.groceryListItems.groceryListId, list.id));
    expect(rows.map((r) => r.name)).toEqual(["chickpeas"]);
    expect(refs.groceryItemIds).toHaveLength(1);
    expect(refs.listId).toBe(list.id);

    await revertPlanSave(tx, card(p, refs));
    const after = await tx
      .select()
      .from(schema.groceryListItems)
      .where(eq(schema.groceryListItems.groceryListId, list.id));
    expect(after).toHaveLength(0);
  });

  it("startPlanImageJobs asks for a cover only for copies without an image", async () => {
    const withImage = await community("Pictured", {
      imageUrl: "https://cdn.example/x.jpg",
    });
    const bare = await community("Bare");
    const p = await buildPlanPayload(
      addMealPlanCardArgsSchema.parse({
        rows: [
          {
            plannedDate: "2026-11-09",
            mealType: "dinner",
            recipe: { source: "community", id: withImage.id },
            alternatives: [],
          },
          {
            plannedDate: "2026-11-10",
            mealType: "dinner",
            recipe: { source: "community", id: bare.id },
            alternatives: [],
          },
        ],
      }),
      user.id,
    );
    const refs = await performPlanSave(tx, card(p), {}, { userId: user.id });
    await startPlanImageJobs(card(p, refs));
    expect(autoGenerateRecipeImage).toHaveBeenCalledTimes(1);
    expect(autoGenerateRecipeImage).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Bare" }),
      user.id,
    );
  });
});
