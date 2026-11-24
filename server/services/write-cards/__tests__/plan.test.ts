import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
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
import { MAX_GROCERY_LIST_ITEMS } from "@shared/constants/grocery";
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
const { planGroceryCard, addGroceryCardArgsSchema } = await import(
  "../grocery"
);

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

  it("a row the model gave no alternatives gets Swap choices from this turn's finder results", async () => {
    const [a, b, c, d, e] = await Promise.all(
      ["Lentil stew", "Bean tacos", "Tofu curry", "Chicken bowl", "Salmon"].map(
        (t) => community(t),
      ),
    );
    const p = await buildPlanPayload(
      addMealPlanCardArgsSchema.parse({
        rows: [
          {
            plannedDate: "2026-11-10",
            mealType: "dinner",
            recipe: { source: "community", id: a.id },
          },
          {
            plannedDate: "2026-11-11",
            mealType: "dinner",
            recipe: { source: "community", id: b.id },
          },
        ],
      }),
      user.id,
      [a.id, b.id, c.id, d.id, e.id, 999999],
    );
    for (const row of p.rows) {
      const ids = row.alternatives.map((r) => r.id);
      expect(ids.length).toBeGreaterThanOrEqual(2);
      expect(ids.length).toBeLessThanOrEqual(3);
      // Never another row's main recipe, its own, or an id that doesn't resolve.
      expect(ids).not.toContain(a.id);
      expect(ids).not.toContain(b.id);
      expect(ids).not.toContain(999999);
    }
    // The two rows don't offer the exact same choices.
    expect(p.rows[0].alternatives.map((r) => r.id)).not.toEqual(
      p.rows[1].alternatives.map((r) => r.id),
    );
  });

  it("the model's own alternatives come first and the finder pool only tops them up", async () => {
    const [main, own, x, y] = await Promise.all(
      ["Main", "Own pick", "Pool X", "Pool Y"].map((t) => community(t)),
    );
    const p = await buildPlanPayload(
      addMealPlanCardArgsSchema.parse({
        rows: [
          {
            plannedDate: "2026-11-10",
            mealType: "dinner",
            recipe: { source: "community", id: main.id },
            alternatives: [{ source: "community", id: own.id }],
          },
        ],
      }),
      user.id,
      [own.id, x.id, y.id],
    );
    expect(p.rows[0].alternatives.map((r) => r.id)).toEqual([
      own.id,
      x.id,
      y.id,
    ]);
  });

  it("a finder-pool recipe unsafe for the user's allergies is never offered", async () => {
    await createTestUserProfile(tx, user.id, {
      allergies: [{ name: "peanuts", severity: "severe" }],
    });
    const main = await community("Main");
    const unsafe = await community("Satay");
    await tx
      .update(schema.communityRecipes)
      .set({ allergens: [] })
      .where(eq(schema.communityRecipes.id, main.id));
    await tx
      .update(schema.communityRecipes)
      .set({ allergens: [{ id: "peanuts", viaDerived: false }] })
      .where(eq(schema.communityRecipes.id, unsafe.id));
    const p = await buildPlanPayload(
      addMealPlanCardArgsSchema.parse({
        rows: [
          {
            plannedDate: "2026-11-10",
            mealType: "dinner",
            recipe: { source: "community", id: main.id },
          },
        ],
      }),
      user.id,
      [unsafe.id],
    );
    expect(p.rows[0].alternatives).toEqual([]);
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

  it("addShopping on a full list still plans the meal and adds nothing", async () => {
    const [list] = await tx
      .insert(schema.groceryLists)
      .values({
        userId: user.id,
        title: "Weekly shop",
        dateRangeStart: "2026-11-01",
        dateRangeEnd: "2026-11-07",
      })
      .returning();
    await tx.insert(schema.groceryListItems).values(
      Array.from({ length: MAX_GROCERY_LIST_ITEMS }, (_, i) => ({
        groceryListId: list.id,
        name: `Seed ${i}`,
      })),
    );
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
    const refs = await performPlanSave(
      tx,
      card(p),
      { addShopping: true },
      { userId: user.id },
    );
    expect(refs.mealPlanItemIds).toHaveLength(1);
    expect(refs.groceryItemIds).toEqual([]);
    expect(refs.groceryListFull).toBeGreaterThan(0);
    const [{ count }] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.groceryListItems)
      .where(eq(schema.groceryListItems.groceryListId, list.id));
    expect(count).toBe(MAX_GROCERY_LIST_ITEMS);
  });

  it("addShopping answers like the grocery card for the same pantry and items", async () => {
    const [list] = await tx
      .insert(schema.groceryLists)
      .values({
        userId: user.id,
        title: "Weekly shop",
        dateRangeStart: "2026-11-01",
        dateRangeEnd: "2026-11-07",
      })
      .returning();
    // "Chickpeas" asked for; the pantry holds it singular, in the same unit.
    // "Spinach" asked for in bags; the pantry has it in another unit (unsure).
    await tx.insert(schema.pantryItems).values([
      { userId: user.id, name: "chickpea", quantity: "3", unit: "can" },
      { userId: user.id, name: "spinach", quantity: "2", unit: "cups" },
    ]);
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
    await performPlanSave(
      tx,
      card(p),
      { addShopping: true },
      { userId: user.id },
    );
    const added = (
      await tx
        .select()
        .from(schema.groceryListItems)
        .where(eq(schema.groceryListItems.groceryListId, list.id))
    )
      .map((r) => r.name)
      .sort();

    const grocery = await planGroceryCard(
      addGroceryCardArgsSchema.parse({
        items: [
          { name: "chickpeas", quantity: "1", unit: "can" },
          { name: "spinach", quantity: "1", unit: "bag" },
        ],
      }),
      user.id,
    );
    const onCard = (grocery.payload?.items ?? []).map((i) => i.name).sort();
    expect(added).toEqual(onCard);
    expect(added).toEqual(["spinach"]);
  });

  describe("with a shopping section (A1)", () => {
    const groceryLists = () =>
      tx
        .select()
        .from(schema.groceryLists)
        .where(eq(schema.groceryLists.userId, user.id));
    const itemsOn = (listId: number) =>
      tx
        .select()
        .from(schema.groceryListItems)
        .where(eq(schema.groceryListItems.groceryListId, listId));
    const newList = async (title: string) => {
      const [list] = await tx
        .insert(schema.groceryLists)
        .values({
          userId: user.id,
          title,
          dateRangeStart: "2026-11-01",
          dateRangeEnd: "2026-11-07",
        })
        .returning();
      return list;
    };

    async function combined() {
      const shawarma = await community("Chicken shawarma bowl");
      const stew = await mine("Lentil stew");
      await tx.insert(schema.recipeIngredients).values({
        recipeId: stew.id,
        name: "Red lentils",
        quantity: "200",
        unit: "g",
        displayOrder: 0,
      });
      const args = addMealPlanCardArgsSchema.parse({
        withGroceryList: true,
        rows: [
          {
            plannedDate: "2026-11-09",
            mealType: "dinner",
            recipe: { source: "community", id: shawarma.id },
            alternatives: [],
          },
          {
            plannedDate: "2026-11-11",
            mealType: "dinner",
            recipe: { source: "mine", id: stew.id },
            alternatives: [],
          },
        ],
      });
      return { args, shawarma, stew };
    }

    it("the card carries the lists and each recipe's ingredient names", async () => {
      const list = await newList("Weekly shop");
      const { args, shawarma, stew } = await combined();
      const p = await buildPlanPayload(args, user.id, [], { shopping: true });
      expect(p.shopping).toEqual({
        lists: [{ id: list.id, title: "Weekly shop" }],
        defaultListId: list.id,
        newListName: "Meal plan shopping",
        ingredients: {
          [`community:${shawarma.id}`]: ["Chickpeas", "Spinach"],
          [`mine:${stew.id}`]: ["Red lentils"],
        },
      });
    });

    it("no section for an app that cannot draw it, or when the list was not asked for", async () => {
      const { args } = await combined();
      expect((await buildPlanPayload(args, user.id)).shopping).toBeUndefined();
      expect(
        (
          await buildPlanPayload(
            { ...args, withGroceryList: undefined },
            user.id,
            [],
            { shopping: true },
          )
        ).shopping,
      ).toBeUndefined();
    });

    it("one save plans the meals and adds the shopping to a new list; one undo removes both", async () => {
      const { args } = await combined();
      const p = await buildPlanPayload(args, user.id, [], { shopping: true });
      expect(p.shopping?.defaultListId).toBeNull();
      const refs = await performPlanSave(tx, card(p), {}, { userId: user.id });
      expect(await planItems()).toHaveLength(2);
      const [list] = await groceryLists();
      expect(list).toMatchObject({
        title: "Meal plan shopping",
        dateRangeStart: "2026-11-09",
        dateRangeEnd: "2026-11-11",
      });
      expect((await itemsOn(list.id)).map((r) => r.name).sort()).toEqual([
        "chickpeas",
        "red lentils",
        "spinach",
      ]);
      expect(refs).toMatchObject({ createdListId: list.id, listId: list.id });

      await revertPlanSave(tx, card(p, refs));
      expect(await planItems()).toHaveLength(0);
      expect(await groceryLists()).toHaveLength(0);
    });

    it("saves to the list the user picked, skipping lines already waiting there", async () => {
      await newList("Weekly shop");
      const other = await newList("Party");
      await tx.insert(schema.groceryListItems).values({
        groceryListId: other.id,
        name: "chickpeas",
        quantity: "1",
        unit: "can",
      });
      const { args } = await combined();
      const p = await buildPlanPayload(args, user.id, [], { shopping: true });
      const refs = await performPlanSave(
        tx,
        card(p),
        { shoppingListId: other.id },
        { userId: user.id },
      );
      expect(refs.listId).toBe(other.id);
      expect(refs.createdListId).toBeUndefined();
      expect((await itemsOn(other.id)).map((r) => r.name).sort()).toEqual([
        "chickpeas",
        "red lentils",
        "spinach",
      ]);
      expect(refs.groceryItemIds).toHaveLength(2);
    });

    it("turned off, it plans the meals and touches no list", async () => {
      const { args } = await combined();
      const p = await buildPlanPayload(args, user.id, [], { shopping: true });
      const refs = await performPlanSave(
        tx,
        card(p),
        { addShopping: false },
        { userId: user.id },
      );
      expect(await planItems()).toHaveLength(2);
      expect(await groceryLists()).toHaveLength(0);
      expect(refs.listId).toBeUndefined();
    });

    it("refuses a list the card did not offer, and a list choice on a card without the section", async () => {
      const stranger = await createTestUser(tx);
      const [theirs] = await tx
        .insert(schema.groceryLists)
        .values({
          userId: stranger.id,
          title: "Theirs",
          dateRangeStart: "2026-11-01",
          dateRangeEnd: "2026-11-07",
        })
        .returning();
      const { args } = await combined();
      const p = await buildPlanPayload(args, user.id, [], { shopping: true });
      await expect(
        performPlanSave(
          tx,
          card(p),
          { shoppingListId: theirs.id },
          { userId: user.id },
        ),
      ).rejects.toBeInstanceOf(WriteCardEditError);
      const plain = await buildPlanPayload(args, user.id);
      await expect(
        performPlanSave(
          tx,
          card(plain),
          { addShopping: true, shoppingListId: "new" },
          { userId: user.id },
        ),
      ).rejects.toBeInstanceOf(WriteCardEditError);
      expect(await planItems()).toHaveLength(0);
    });

    it("makes no new list when the pantry covers everything", async () => {
      await tx.insert(schema.pantryItems).values([
        { userId: user.id, name: "spinach", quantity: "5", unit: "bag" },
        { userId: user.id, name: "chickpeas", quantity: "5", unit: "can" },
        { userId: user.id, name: "red lentils", quantity: "900", unit: "g" },
      ]);
      const { args } = await combined();
      const p = await buildPlanPayload(args, user.id, [], { shopping: true });
      const refs = await performPlanSave(tx, card(p), {}, { userId: user.id });
      expect(await groceryLists()).toHaveLength(0);
      expect(refs.groceryItemIds ?? []).toHaveLength(0);
    });
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
