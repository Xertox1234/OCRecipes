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
import * as schema from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const { getGroceryListsWithOpenItems } = await import("../grocery-lists");

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;

async function makeList(userId: string, title: string, createdAt: Date) {
  const [list] = await tx
    .insert(schema.groceryLists)
    .values({
      userId,
      title,
      dateRangeStart: "2026-11-01",
      dateRangeEnd: "2026-11-07",
      createdAt,
    })
    .returning();
  return list;
}

describe("getGroceryListsWithOpenItems", () => {
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

  it("returns the newest lists first with the items still to buy and a bought count", async () => {
    const old = await makeList(user.id, "Old", new Date("2026-10-01"));
    const recent = await makeList(
      user.id,
      "Weekly shop",
      new Date("2026-11-08"),
    );
    await tx.insert(schema.groceryListItems).values([
      { groceryListId: recent.id, name: "Milk", quantity: "2", unit: "L" },
      { groceryListId: recent.id, name: "Eggs", isChecked: true },
      { groceryListId: recent.id, name: "Bread", isChecked: null },
      { groceryListId: old.id, name: "Rice" },
    ]);
    const lists = await getGroceryListsWithOpenItems(user.id);
    expect(lists.map((l) => l.title)).toEqual(["Weekly shop", "Old"]);
    expect(lists[0].items.map((i) => i.name).sort()).toEqual(["Bread", "Milk"]);
    expect(lists[0].boughtCount).toBe(1);
    expect(lists[1].items.map((i) => i.name)).toEqual(["Rice"]);
    expect(lists[1].boughtCount).toBe(0);
  });

  it("caps the open items per list in the query and still counts them all", async () => {
    const big = await makeList(user.id, "Big shop", new Date("2026-11-08"));
    const small = await makeList(user.id, "Small", new Date("2026-11-01"));
    await tx.insert(schema.groceryListItems).values([
      ...Array.from({ length: 7 }, (_, i) => ({
        groceryListId: big.id,
        name: `Item ${i}`,
        category: "pantry",
      })),
      { groceryListId: big.id, name: "Bought", isChecked: true },
      { groceryListId: small.id, name: "Tea" },
    ]);
    const lists = await getGroceryListsWithOpenItems(user.id, {
      itemsPerList: 3,
    });
    expect(lists[0].items.map((i) => i.name)).toEqual([
      "Item 0",
      "Item 1",
      "Item 2",
    ]);
    expect(lists[0].openCount).toBe(7);
    expect(lists[0].boughtCount).toBe(1);
    // The cap is per list, not across lists.
    expect(lists[1].items.map((i) => i.name)).toEqual(["Tea"]);
    expect(lists[1].openCount).toBe(1);
  });

  it("never returns another user's lists or items", async () => {
    const other = await createTestUser(tx);
    const theirs = await makeList(
      other.id,
      "Weekly shop",
      new Date("2026-11-08"),
    );
    await tx
      .insert(schema.groceryListItems)
      .values({ groceryListId: theirs.id, name: "Secret" });
    expect(await getGroceryListsWithOpenItems(user.id)).toEqual([]);
    expect(
      await getGroceryListsWithOpenItems(user.id, { titleContains: "weekly" }),
    ).toEqual([]);
  });

  it("limits the lists and filters by title, treating % and _ as plain text", async () => {
    for (let i = 0; i < 6; i++) {
      await makeList(user.id, `Shop ${i}`, new Date(Date.UTC(2026, 10, 1 + i)));
    }
    await makeList(user.id, "BBQ 100%", new Date("2026-09-01"));
    expect(await getGroceryListsWithOpenItems(user.id)).toHaveLength(4);
    expect(
      await getGroceryListsWithOpenItems(user.id, { limit: 2 }),
    ).toHaveLength(2);
    const bbq = await getGroceryListsWithOpenItems(user.id, {
      titleContains: "bbq",
    });
    expect(bbq.map((l) => l.title)).toEqual(["BBQ 100%"]);
    const pct = await getGroceryListsWithOpenItems(user.id, {
      titleContains: "%",
    });
    expect(pct.map((l) => l.title)).toEqual(["BBQ 100%"]);
    expect(
      await getGroceryListsWithOpenItems(user.id, { titleContains: "_" }),
    ).toEqual([]);
  });
});
