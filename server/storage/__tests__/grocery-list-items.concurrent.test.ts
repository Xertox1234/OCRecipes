/**
 * Multi-connection concurrency test for the per-list grocery item cap.
 *
 * Like `pantry.concurrent.test.ts`, this does NOT mock `../../db` or use the
 * savepoint harness (both force a single connection, which cannot race).
 * Parallel calls check out distinct pool connections, so each is a genuine
 * separate transaction. Without the per-list advisory lock, READ COMMITTED
 * lets two calls both count room and both insert, landing the list over the
 * cap.
 *
 * Rows are committed and cleaned up in `afterAll` (lists and their items
 * cascade from users on delete).
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { db, pool } from "../../db";
import { users, groceryLists, groceryListItems } from "@shared/schema";
import {
  insertGroceryListItemsUnderCap,
  MAX_GROCERY_LIST_ITEMS,
} from "../grocery-lists";

const createdUserIds: string[] = [];

async function createCommittedList(
  seedItems: number,
): Promise<{ listId: number; userId: string }> {
  const [user] = await db
    .insert(users)
    .values({
      username: `grocery_cap_${crypto.randomUUID()}`,
      email: `grocery_cap_${crypto.randomUUID()}@test.invalid`,
      password: "hashed_password_placeholder",
    })
    .returning({ id: users.id });
  createdUserIds.push(user.id);
  const [list] = await db
    .insert(groceryLists)
    .values({
      userId: user.id,
      title: "Cap test",
      dateRangeStart: "2026-11-18",
      dateRangeEnd: "2026-11-24",
    })
    .returning({ id: groceryLists.id });
  if (seedItems > 0) {
    await db.insert(groceryListItems).values(
      Array.from({ length: seedItems }, (_, i) => ({
        groceryListId: list.id,
        name: `Seed ${i}`,
        // Bought items still take a place on the list.
        isChecked: i % 2 === 0,
      })),
    );
  }
  return { listId: list.id, userId: user.id };
}

async function committedCount(listId: number): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(groceryListItems)
    .where(eq(groceryListItems.groceryListId, listId));
  return row.count;
}

afterAll(async () => {
  for (const userId of createdUserIds) {
    await db.delete(users).where(eq(users.id, userId));
  }
  await pool.end();
}, 60_000);

describe("insertGroceryListItemsUnderCap", () => {
  it("refuses the item past the cap, counting bought items too", async () => {
    const { listId, userId } = await createCommittedList(
      MAX_GROCERY_LIST_ITEMS,
    );
    const result = await insertGroceryListItemsUnderCap(listId, userId, [
      { name: "One too many" },
    ]);
    expect(result.created).toHaveLength(0);
    expect(result.skipped).toBe(1);
    expect(await committedCount(listId)).toBe(MAX_GROCERY_LIST_ITEMS);
  });

  it("refuses another user's list and adds nothing to it (IDOR)", async () => {
    const { listId } = await createCommittedList(0);
    const { userId: otherUserId } = await createCommittedList(0);
    await expect(
      insertGroceryListItemsUnderCap(listId, otherUserId, [{ name: "Sneaky" }]),
    ).rejects.toThrow("Grocery list not found");
    expect(await committedCount(listId)).toBe(0);
  });

  it("adds what fits, in order, and reports the rest", async () => {
    const { listId, userId } = await createCommittedList(
      MAX_GROCERY_LIST_ITEMS - 2,
    );
    const result = await insertGroceryListItemsUnderCap(listId, userId, [
      { name: "A" },
      { name: "B" },
      { name: "C" },
    ]);
    expect(result.created.map((r) => r.name)).toEqual(["A", "B"]);
    expect(result.created.every((r) => r.groceryListId === listId)).toBe(true);
    expect(result.skipped).toBe(1);
  });

  it("never exceeds the cap when single adds race at the boundary", async () => {
    for (let iter = 0; iter < 10; iter++) {
      const { listId, userId } = await createCommittedList(
        MAX_GROCERY_LIST_ITEMS - 1,
      );
      const results = await Promise.all([
        insertGroceryListItemsUnderCap(listId, userId, [{ name: "Race A" }]),
        insertGroceryListItemsUnderCap(listId, userId, [{ name: "Race B" }]),
      ]);
      const added = results.reduce((n, r) => n + r.created.length, 0);
      expect(added).toBe(1);
      expect(results.reduce((n, r) => n + r.skipped, 0)).toBe(1);
      expect(await committedCount(listId)).toBe(MAX_GROCERY_LIST_ITEMS);
    }
  }, 60_000);
});
