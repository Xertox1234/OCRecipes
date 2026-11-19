import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import type { GroceryCardPayload } from "@shared/schemas/coach-write-cards";
import { MAX_GROCERY_LIST_ITEMS } from "@shared/constants/grocery";
import { createMockCoachWriteCard } from "../../../__tests__/factories";

vi.mock("../../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  buildGroceryPayload,
  planGroceryCard,
  performGrocerySave,
  revertGrocerySave,
  groceryReceipt,
  addGroceryCardArgsSchema,
} = await import("../grocery");
const { WriteCardEditError } = await import("../errors");

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;

async function makeList(title: string, createdAt: Date) {
  const [list] = await tx
    .insert(schema.groceryLists)
    .values({
      userId: user.id,
      title,
      dateRangeStart: "2026-11-01",
      dateRangeEnd: "2026-11-07",
      createdAt,
    })
    .returning();
  return list;
}

const itemsOf = (listId: number) =>
  tx
    .select()
    .from(schema.groceryListItems)
    .where(eq(schema.groceryListItems.groceryListId, listId));

const listsOf = () =>
  tx
    .select()
    .from(schema.groceryLists)
    .where(eq(schema.groceryLists.userId, user.id));

const ctx = () => ({ userId: user.id, tz: "UTC", now: new Date() });

/** A refusal the user is shown: the right error type and its exact words. */
async function refused(attempt: Promise<unknown>, message: string) {
  const err: unknown = await attempt.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(WriteCardEditError);
  expect((err as Error).message).toBe(message);
}

describe("grocery write card", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    user = await createTestUser(tx);
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  const args = addGroceryCardArgsSchema.parse({
    items: [
      { name: "Red lentils", quantity: "500", unit: "g" },
      { name: "Onions", quantity: "2" },
      { name: "Ginger", maybeHave: true },
      { name: "Spinach", quantity: "1", unit: "bag" },
    ],
    listName: "Lentil stew",
  });

  const pantry = (
    name: string,
    more: Partial<typeof schema.pantryItems.$inferInsert> = {},
  ) => tx.insert(schema.pantryItems).values({ userId: user.id, name, ...more });
  const one = (item: Record<string, unknown>) =>
    addGroceryCardArgsSchema.parse({ items: [item, { name: "Bread" }] });

  it("a pantry item that covers the amount is left off", async () => {
    await pantry("red lentils", { quantity: "1000", unit: "g" });
    const plan = await planGroceryCard(args, user.id);
    expect(plan.payload?.items.map((i) => i.name)).toEqual([
      "Onions",
      "Ginger",
      "Spinach",
    ]);
    expect(plan.leftOff).toEqual(["Red lentils"]);
    expect(plan.unticked).toEqual([]);
  });

  it("an item asked for with no amount is left off when the pantry has it", async () => {
    await pantry("spinach");
    const plan = await planGroceryCard(one({ name: "Spinach" }), user.id);
    expect(plan.leftOff).toEqual(["Spinach"]);
  });

  it("a pantry amount that is too small keeps the item, ticked", async () => {
    await pantry("egg", { quantity: "1" });
    const plan = await planGroceryCard(
      one({ name: "Eggs", quantity: "12" }),
      user.id,
    );
    expect(plan.payload?.items[0]).toMatchObject({
      name: "Eggs",
      ticked: true,
    });
    expect(plan.leftOff).toEqual([]);
    expect(plan.unticked).toEqual([]);
  });

  it("a pantry item with no amount keeps the item, unticked", async () => {
    await pantry("onion");
    const plan = await planGroceryCard(args, user.id);
    expect(plan.payload?.items.find((i) => i.name === "Onions")).toMatchObject({
      ticked: false,
    });
    expect(plan.unticked).toEqual(["Onions"]);
    expect(plan.leftOff).toEqual([]);
  });

  it("a pantry item in another unit keeps the item, unticked", async () => {
    await pantry("red lentils", { quantity: "2", unit: "bags" });
    const plan = await planGroceryCard(args, user.id);
    expect(plan.unticked).toEqual(["Red lentils"]);
  });

  it("an expired or used-up pantry item does not count", async () => {
    await pantry("spinach", { expiresAt: new Date("2026-11-01T00:00:00Z") });
    await pantry("ginger", { quantity: "0" });
    const plan = await planGroceryCard(
      args,
      user.id,
      new Date("2026-11-10T00:00:00Z"),
    );
    expect(plan.leftOff).toEqual([]);
    expect(plan.unticked).toEqual([]);
    expect(plan.payload?.items.find((i) => i.name === "Spinach")?.ticked).toBe(
      true,
    );
  });

  it.each([
    ["apple", "Apples"],
    ["olives", "olive"],
    ["tomato", "Tomatoes"],
    ["berries", "Berry"],
    ["peach", "peaches"],
    ["egg", "eggs"],
    ["cookie", "Cookies"],
    ["brownies", "brownie"],
  ])("pantry %s matches %s", async (inPantry, asked) => {
    await pantry(inPantry);
    const plan = await planGroceryCard(one({ name: asked }), user.id);
    expect(plan.leftOff).toEqual([asked]);
  });

  it("with everything covered there is no card, and the names come back", async () => {
    await pantry("Spinach");
    const plan = await planGroceryCard(
      addGroceryCardArgsSchema.parse({ items: [{ name: "spinach" }] }),
      user.id,
    );
    expect(plan.payload).toBeNull();
    expect(plan.leftOff).toEqual(["spinach"]);
  });

  it("maybeHave items start unticked", async () => {
    const p = await buildGroceryPayload(args, user.id);
    expect(p.items.find((i) => i.name === "Ginger")?.ticked).toBe(false);
    expect(p.items.find((i) => i.name === "Spinach")?.ticked).toBe(true);
  });

  it("default list is the most recent", async () => {
    await makeList("Old", new Date("2026-10-01"));
    const recent = await makeList("Weekly shop", new Date("2026-11-08"));
    const p = await buildGroceryPayload(args, user.id);
    expect(p.defaultListId).toBe(recent.id);
    expect(p.lists[0]).toEqual({ id: recent.id, title: "Weekly shop" });
    expect(p.newListName).toBe("Lentil stew");
  });

  it("offers at most four lists, and none when the user has none", async () => {
    expect((await buildGroceryPayload(args, user.id)).defaultListId).toBeNull();
    for (let i = 0; i < 6; i++) {
      await makeList(`L${i}`, new Date(Date.UTC(2026, 10, 1 + i)));
    }
    expect((await buildGroceryPayload(args, user.id)).lists).toHaveLength(4);
  });

  it("every item already in the pantry leaves nothing to add", async () => {
    await tx
      .insert(schema.pantryItems)
      .values({ userId: user.id, name: "Spinach" });
    await expect(
      buildGroceryPayload(
        addGroceryCardArgsSchema.parse({ items: [{ name: "spinach" }] }),
        user.id,
      ),
    ).rejects.toBeInstanceOf(WriteCardEditError);
  });

  const card = (p: GroceryCardPayload) =>
    createMockCoachWriteCard({ userId: user.id, kind: "grocery", payload: p });

  it("save adds the ticked items to the chosen list", async () => {
    const list = await makeList("Weekly shop", new Date("2026-11-08"));
    const p = await buildGroceryPayload(args, user.id);
    const refs = await performGrocerySave(tx, card(p), {}, ctx());
    const rows = await itemsOf(list.id);
    expect(rows.map((r) => r.name).sort()).toEqual([
      "Onions",
      "Red lentils",
      "Spinach",
    ]);
    expect(rows.find((r) => r.name === "Red lentils")).toMatchObject({
      quantity: "500.00",
      unit: "g",
    });
    expect(refs).toMatchObject({ listId: list.id });
    expect(refs.groceryItemIds).toHaveLength(3);
    expect(refs.createdListId).toBeUndefined();
  });

  it("save to a list id outside payload.lists is rejected", async () => {
    await makeList("Weekly shop", new Date("2026-11-08"));
    const p = await buildGroceryPayload(args, user.id);
    const other = await createTestUser(tx);
    const [foreign] = await tx
      .insert(schema.groceryLists)
      .values({
        userId: other.id,
        title: "Not yours",
        dateRangeStart: "2026-11-01",
        dateRangeEnd: "2026-11-07",
      })
      .returning();
    await expect(
      performGrocerySave(tx, card(p), { listId: foreign.id }, ctx()),
    ).rejects.toBeInstanceOf(WriteCardEditError);
    expect(await itemsOf(foreign.id)).toHaveLength(0);
  });

  it("a new list spans seven civil days even across a DST change (L-xc-3)", async () => {
    const p = await buildGroceryPayload(args, user.id);
    // 2026-11-01 00:30 PDT, the 25-hour fall-back day in Los Angeles.
    const refs = await performGrocerySave(
      tx,
      card(p),
      { listId: "new" },
      {
        userId: user.id,
        tz: "America/Los_Angeles",
        now: new Date("2026-11-01T07:30:00Z"),
      },
    );
    const [created] = await tx
      .select()
      .from(schema.groceryLists)
      .where(eq(schema.groceryLists.id, refs.createdListId!));
    expect(created.dateRangeStart).toBe("2026-11-01");
    expect(created.dateRangeEnd).toBe("2026-11-07");
  });

  it("a quantity too large for numeric(10,2) is saved without a quantity (L-xc-5)", async () => {
    const list = await makeList("Weekly shop", new Date("2026-11-08"));
    const p = await buildGroceryPayload(
      addGroceryCardArgsSchema.parse({
        items: [{ name: "Rice", quantity: "1000000000", unit: "g" }],
      }),
      user.id,
    );
    await performGrocerySave(tx, card(p), { listId: list.id }, ctx());
    expect(await itemsOf(list.id)).toMatchObject([
      { name: "Rice", quantity: null, unit: "g" },
    ]);
  });

  it("save to new list creates it and undo deletes it", async () => {
    const p = await buildGroceryPayload(args, user.id);
    const refs = await performGrocerySave(
      tx,
      card(p),
      { listId: "new" },
      ctx(),
    );
    expect(refs.createdListId).toBeDefined();
    const [created] = await tx
      .select()
      .from(schema.groceryLists)
      .where(eq(schema.groceryLists.id, refs.createdListId!));
    expect(created.title).toBe("Lentil stew");
    expect(await itemsOf(created.id)).toHaveLength(3);

    await revertGrocerySave(
      tx,
      createMockCoachWriteCard({
        userId: user.id,
        kind: "grocery",
        payload: p,
        savedRefs: refs,
      }),
    );
    const left = await tx
      .select()
      .from(schema.groceryLists)
      .where(eq(schema.groceryLists.id, created.id));
    expect(left).toHaveLength(0);
  });

  it("undo removes only the items this save added", async () => {
    const list = await makeList("Weekly shop", new Date("2026-11-08"));
    await tx
      .insert(schema.groceryListItems)
      .values({ groceryListId: list.id, name: "Bread" });
    const p = await buildGroceryPayload(args, user.id);
    const refs = await performGrocerySave(tx, card(p), {}, ctx());
    await revertGrocerySave(
      tx,
      createMockCoachWriteCard({
        userId: user.id,
        kind: "grocery",
        payload: p,
        savedRefs: refs,
      }),
    );
    expect((await itemsOf(list.id)).map((r) => r.name)).toEqual(["Bread"]);
  });

  const saved = (p: GroceryCardPayload, refs: schema.CoachWriteCardSavedRefs) =>
    createMockCoachWriteCard({
      userId: user.id,
      kind: "grocery",
      payload: p,
      savedRefs: refs,
    });

  it("an item already waiting on the list is not added twice", async () => {
    const list = await makeList("Weekly shop", new Date("2026-11-08"));
    await tx.insert(schema.groceryListItems).values([
      { groceryListId: list.id, name: "spinach", quantity: "1", unit: "Bag" },
      // Bought already: asking again is a new purchase.
      {
        groceryListId: list.id,
        name: "Onions",
        quantity: "2",
        isChecked: true,
      },
      // A different amount is a different line.
      {
        groceryListId: list.id,
        name: "Red lentils",
        quantity: "250",
        unit: "g",
      },
    ]);
    const p = await buildGroceryPayload(args, user.id);
    const refs = await performGrocerySave(tx, card(p), {}, ctx());
    expect(refs.groceryItemIds).toHaveLength(2);
    const names = (await itemsOf(list.id)).map((r) => r.name).sort();
    expect(names).toEqual([
      "Onions",
      "Onions",
      "Red lentils",
      "Red lentils",
      "spinach",
    ]);
    expect(groceryReceipt(saved(p, refs))).toBe(
      "✓ Added 2 items to Weekly shop · 1 already there",
    );
  });

  it("saving only items already on the list adds nothing and says so", async () => {
    const list = await makeList("Weekly shop", new Date("2026-11-08"));
    const p = await buildGroceryPayload(
      addGroceryCardArgsSchema.parse({ items: [{ name: "Milk" }] }),
      user.id,
    );
    await performGrocerySave(tx, card(p), {}, ctx());
    const refs = await performGrocerySave(tx, card(p), {}, ctx());
    expect(refs).toEqual({ listId: list.id, groceryItemIds: [] });
    expect(await itemsOf(list.id)).toHaveLength(1);
    expect(groceryReceipt(saved(p, refs))).toBe("✓ Already on Weekly shop");
  });

  it("a nearly full list takes what fits and the receipt says the rest didn't fit", async () => {
    const list = await makeList("Weekly shop", new Date("2026-11-08"));
    await tx.insert(schema.groceryListItems).values(
      Array.from({ length: MAX_GROCERY_LIST_ITEMS - 1 }, (_, i) => ({
        groceryListId: list.id,
        name: `Seed ${i}`,
      })),
    );
    const p = await buildGroceryPayload(args, user.id);
    const refs = await performGrocerySave(tx, card(p), {}, ctx());
    expect(refs.groceryItemIds).toHaveLength(1);
    expect(refs.groceryListFull).toBe(2);
    expect(await itemsOf(list.id)).toHaveLength(MAX_GROCERY_LIST_ITEMS);
    expect(groceryReceipt(saved(p, refs))).toBe(
      "✓ Added 1 item to Weekly shop · 2 didn't fit (list full)",
    );
  });

  it("the receipt counts what a plain save added", async () => {
    await makeList("Weekly shop", new Date("2026-11-08"));
    const p = await buildGroceryPayload(args, user.id);
    const refs = await performGrocerySave(tx, card(p), {}, ctx());
    expect(groceryReceipt(saved(p, refs))).toBe(
      "✓ Added 3 items to Weekly shop",
    );
  });

  it("unticking everything leaves nothing to save", async () => {
    const p = await buildGroceryPayload(args, user.id);
    await expect(
      performGrocerySave(
        tx,
        card(p),
        { ticked: p.items.map(() => false), listId: "new" },
        ctx(),
      ),
    ).rejects.toBeInstanceOf(WriteCardEditError);
  });

  // Each of these fails for a mutant the tests above let through
  // (Stryker run on grocery.ts, 2026-11-19).
  describe("refusals say why", () => {
    it("with everything in the pantry", async () => {
      await pantry("Spinach");
      await refused(
        buildGroceryPayload(
          addGroceryCardArgsSchema.parse({ items: [{ name: "spinach" }] }),
          user.id,
        ),
        "Everything is already in the pantry.",
      );
    });

    it.each([
      ["a tick list of the wrong length", { ticked: [true] }],
      ["ticks that are not a list", { ticked: "yes" }],
      ["a field the card does not have", { extra: 1 }],
    ])("with %s", async (_label, edits) => {
      const list = await makeList("Weekly shop", new Date("2026-11-08"));
      const p = await buildGroceryPayload(args, user.id);
      await refused(
        performGrocerySave(tx, card(p), edits, ctx()),
        "These changes can't be saved.",
      );
      expect(await itemsOf(list.id)).toHaveLength(0);
    });

    it("with nothing ticked", async () => {
      const p = await buildGroceryPayload(args, user.id);
      await refused(
        performGrocerySave(
          tx,
          card(p),
          { ticked: p.items.map(() => false) },
          ctx(),
        ),
        "Nothing to add.",
      );
    });

    it("with fifty lists already, and no list is created", async () => {
      await tx.insert(schema.groceryLists).values(
        Array.from({ length: 50 }, (_, i) => ({
          userId: user.id,
          title: `List ${i}`,
          dateRangeStart: "2026-11-01",
          dateRangeEnd: "2026-11-07",
        })),
      );
      const p = await buildGroceryPayload(args, user.id);
      await refused(
        performGrocerySave(tx, card(p), { listId: "new" }, ctx()),
        "You have too many grocery lists.",
      );
      expect(await listsOf()).toHaveLength(50);
    });

    it("with a list the card offered that is no longer the user's", async () => {
      const list = await makeList("Weekly shop", new Date("2026-11-08"));
      const p = await buildGroceryPayload(args, user.id);
      const other = await createTestUser(tx);
      await tx
        .update(schema.groceryLists)
        .set({ userId: other.id })
        .where(eq(schema.groceryLists.id, list.id));
      await refused(
        performGrocerySave(tx, card(p), {}, ctx()),
        "That list isn't available.",
      );
      expect(await itemsOf(list.id)).toHaveLength(0);
    });

    it("with one of the user's lists that the card did not offer", async () => {
      await makeList("Weekly shop", new Date("2026-11-08"));
      const p = await buildGroceryPayload(args, user.id);
      const later = await makeList("Party", new Date("2026-11-09"));
      await refused(
        performGrocerySave(tx, card(p), { listId: later.id }, ctx()),
        "That list isn't available.",
      );
      expect(await itemsOf(later.id)).toHaveLength(0);
    });
  });

  it("a card with no list name offers the default name", async () => {
    const p = await buildGroceryPayload(one({ name: "Milk" }), user.id);
    expect(p.newListName).toBe("Coach list");
  });

  it("saves only the items the user left ticked", async () => {
    const list = await makeList("Weekly shop", new Date("2026-11-08"));
    const p = await buildGroceryPayload(args, user.id);
    await performGrocerySave(
      tx,
      card(p),
      { ticked: [true, false, false, false] },
      ctx(),
    );
    expect((await itemsOf(list.id)).map((r) => r.name)).toEqual([
      "Red lentils",
    ]);
  });

  it("the largest amount the column holds is saved as it is", async () => {
    const list = await makeList("Weekly shop", new Date("2026-11-08"));
    const p = await buildGroceryPayload(
      addGroceryCardArgsSchema.parse({
        items: [{ name: "Rice", quantity: "99999999.99", unit: "g" }],
      }),
      user.id,
    );
    await performGrocerySave(tx, card(p), {}, ctx());
    expect(await itemsOf(list.id)).toMatchObject([
      { name: "Rice", quantity: "99999999.99" },
    ]);
  });

  it("with no list to offer, a plain save makes a new one and names what it added", async () => {
    const p = await buildGroceryPayload(args, user.id);
    const refs = await performGrocerySave(tx, card(p), {}, ctx());
    const [created] = await listsOf();
    expect(created.title).toBe("Lentil stew");
    const ids = (await itemsOf(created.id)).map((r) => r.id);
    expect(ids).toHaveLength(3);
    // Exactly these keys: no "list full" count when everything fitted.
    expect({
      ...refs,
      groceryItemIds: [...(refs.groceryItemIds ?? [])].sort(),
    }).toEqual({
      createdListId: created.id,
      listId: created.id,
      groceryItemIds: [...ids].sort(),
    });
    expect(groceryReceipt(saved(p, refs))).toBe(
      "✓ Added 3 items to Lentil stew",
    );
  });

  it("a new list takes what fits and records how many did not", async () => {
    const p: GroceryCardPayload = {
      items: Array.from({ length: MAX_GROCERY_LIST_ITEMS + 1 }, (_, i) => ({
        name: `Item ${i}`,
        quantity: null,
        unit: null,
        ticked: true,
      })),
      lists: [],
      defaultListId: null,
      newListName: "Big shop",
    };
    const refs = await performGrocerySave(tx, card(p), {}, ctx());
    expect(refs.groceryItemIds).toHaveLength(MAX_GROCERY_LIST_ITEMS);
    expect(refs.groceryListFull).toBe(1);
  });

  it("with two lists offered, the save goes to the one chosen", async () => {
    const old = await makeList("Old", new Date("2026-10-01"));
    const recent = await makeList("Weekly shop", new Date("2026-11-08"));
    const p = await buildGroceryPayload(args, user.id);
    const refs = await performGrocerySave(
      tx,
      card(p),
      { listId: old.id },
      ctx(),
    );
    expect(await itemsOf(old.id)).toHaveLength(3);
    expect(await itemsOf(recent.id)).toHaveLength(0);
    expect(groceryReceipt(saved(p, refs))).toBe("✓ Added 3 items to Old");
  });

  describe("undo with nothing to take back", () => {
    it("a card that was never saved", async () => {
      const list = await makeList("Weekly shop", new Date("2026-11-08"));
      const p = await buildGroceryPayload(args, user.id);
      await expect(revertGrocerySave(tx, card(p))).resolves.toBeUndefined();
      expect(await listsOf()).toHaveLength(1);
      expect(list.id).toBeGreaterThan(0);
    });

    it("a save that recorded a list but no items", async () => {
      const list = await makeList("Weekly shop", new Date("2026-11-08"));
      await tx
        .insert(schema.groceryListItems)
        .values({ groceryListId: list.id, name: "Bread" });
      const p = await buildGroceryPayload(args, user.id);
      await expect(
        revertGrocerySave(tx, saved(p, { listId: list.id })),
      ).resolves.toBeUndefined();
      expect(await itemsOf(list.id)).toHaveLength(1);
    });
  });

  describe("the receipt, from what the save recorded", () => {
    const three: GroceryCardPayload = {
      items: ["Apples", "Bread", "Cheese"].map((name) => ({
        name,
        quantity: null,
        unit: null,
        ticked: true,
      })),
      lists: [
        { id: 7, title: "Weekly shop" },
        { id: 9, title: "Party" },
      ],
      defaultListId: 7,
      newListName: "Coach list",
    };

    it("a card that was never saved", () => {
      expect(groceryReceipt(card(three))).toBe("✓ Added 3 items");
    });

    it.each<[string, schema.CoachWriteCardSavedRefs, string]>([
      [
        "a list and no item ids",
        { listId: 7 },
        "✓ Added 3 items to Weekly shop",
      ],
      [
        "the second list offered",
        { listId: 9, groceryItemIds: [1, 2, 3] },
        "✓ Added 3 items to Party",
      ],
      [
        "a list the card did not offer",
        { listId: 99, groceryItemIds: [1, 2, 3] },
        "✓ Added 3 items",
      ],
      [
        "a list the save created",
        { listId: 8, createdListId: 8, groceryItemIds: [1, 2, 3] },
        "✓ Added 3 items to Coach list",
      ],
      [
        "a full list",
        { listId: 7, groceryItemIds: [], groceryListFull: 3 },
        "✓ Weekly shop is full",
      ],
      [
        "a full list with no title",
        { groceryItemIds: [], groceryListFull: 3 },
        "✓ Your list is full",
      ],
      [
        "everything already there, no title",
        { groceryItemIds: [] },
        "✓ Already on your list",
      ],
      [
        "some already there and the rest did not fit",
        { listId: 7, groceryItemIds: [], groceryListFull: 1 },
        "✓ Already on Weekly shop · 1 didn't fit (list full)",
      ],
      [
        "a partial add with no title",
        { groceryItemIds: [1], groceryListFull: 2 },
        "✓ Added 1 item · 2 didn't fit (list full)",
      ],
      [
        "one added, one already there, one did not fit",
        { listId: 7, groceryItemIds: [1], groceryListFull: 1 },
        "✓ Added 1 item to Weekly shop · 1 already there · 1 didn't fit (list full)",
      ],
    ])("%s", (_label, refs, line) => {
      expect(groceryReceipt(saved(three, refs))).toBe(line);
    });
  });
});
