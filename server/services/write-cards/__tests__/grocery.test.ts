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

const ctx = () => ({ userId: user.id, tz: "UTC", now: new Date() });

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
});
