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
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  lockPantryAndGetRoom,
  getPantryItemForUpdate,
  setPantryItemQuantityInTx,
  deletePantryItemInTx,
  restorePantryItemsUnderCap,
  MAX_PANTRY_ITEMS,
} = await import("../pantry");

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;
let other: schema.User;

const add = async (userId: string, name: string, quantity: string | null) => {
  const [row] = await tx
    .insert(schema.pantryItems)
    .values({ userId, name, quantity })
    .returning();
  return row;
};
const rowsOf = (userId: string) =>
  tx
    .select()
    .from(schema.pantryItems)
    .where(eq(schema.pantryItems.userId, userId));

describe("pantry storage inside a caller's transaction", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    user = await createTestUser(tx);
    other = await createTestUser(tx);
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  it("the lock reports the room left under the cap", async () => {
    await add(user.id, "Milk", "2");
    const room = await tx.transaction((inner) =>
      lockPantryAndGetRoom(inner, user.id),
    );
    expect(room).toBe(MAX_PANTRY_ITEMS - 1);
  });

  it("reads, updates and deletes the user's own row", async () => {
    const milk = await add(user.id, "Milk", "2");
    await tx.transaction(async (inner) => {
      const row = await getPantryItemForUpdate(inner, milk.id, user.id);
      expect(row?.quantity).toBe("2.00");
      expect(
        await setPantryItemQuantityInTx(inner, milk.id, user.id, "1"),
      ).toBe(true);
    });
    expect((await rowsOf(user.id))[0].quantity).toBe("1.00");
    await tx.transaction(async (inner) => {
      expect(await deletePantryItemInTx(inner, milk.id, user.id)).toBe(true);
    });
    expect(await rowsOf(user.id)).toHaveLength(0);
  });

  it("restores a deleted row under its original id, and leaves a taken id alone", async () => {
    const milk = await add(user.id, "Milk", "2");
    const theirs = await add(other.id, "Their milk", "9");
    await tx.transaction(async (inner) => {
      await deletePantryItemInTx(inner, milk.id, user.id);
      const result = await restorePantryItemsUnderCap(inner, user.id, [
        { id: milk.id, userId: user.id, name: "Milk", quantity: "2" },
        // An id that is in use (here another user's) is never overwritten.
        { id: theirs.id, userId: user.id, name: "Hijack", quantity: "1" },
      ]);
      expect(result.created.map((r) => r.id)).toEqual([milk.id]);
      expect(result.skipped).toBe(1);
    });
    expect((await rowsOf(user.id)).map((r) => [r.id, r.name])).toEqual([
      [milk.id, "Milk"],
    ]);
    expect((await rowsOf(other.id)).map((r) => [r.name, r.quantity])).toEqual([
      ["Their milk", "9.00"],
    ]);
  });

  it("never reads, updates or deletes another user's row", async () => {
    const theirs = await add(other.id, "Milk", "2");
    await tx.transaction(async (inner) => {
      expect(
        await getPantryItemForUpdate(inner, theirs.id, user.id),
      ).toBeUndefined();
      expect(
        await setPantryItemQuantityInTx(inner, theirs.id, user.id, "0"),
      ).toBe(false);
      expect(await deletePantryItemInTx(inner, theirs.id, user.id)).toBe(false);
    });
    expect((await rowsOf(other.id))[0].quantity).toBe("2.00");
  });
});
