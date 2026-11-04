/**
 * Multi-connection concurrency test for the grocery-list cap.
 *
 * Like `pantry.concurrent.test.ts`, this does NOT mock `../../db` or use the
 * savepoint harness (both force a single connection, which cannot race).
 * Parallel calls check out distinct pool connections, so each is a genuine
 * separate transaction. Without the advisory lock, READ COMMITTED lets two
 * calls both see room and both insert, landing the user over the cap.
 *
 * Rows are committed and cleaned up in `afterAll` (grocery_lists cascades from
 * users on delete).
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { db, pool } from "../../db";
import { users, groceryLists } from "@shared/schema";
import { createGroceryListWithLimitCheck } from "../grocery-lists";

const MAX_LISTS = 5;
const createdUserIds: string[] = [];

async function createCommittedUser(): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      username: `grocery_concurrent_${crypto.randomUUID()}`,
      email: `grocery_concurrent_${crypto.randomUUID()}@test.invalid`,
      password: "hashed_password_placeholder",
    })
    .returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function committedCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(groceryLists)
    .where(eq(groceryLists.userId, userId));
  return row.count;
}

const list = (userId: string, title: string) => ({
  userId,
  title,
  dateRangeStart: "2026-11-01",
  dateRangeEnd: "2026-11-07",
});

afterAll(async () => {
  for (const userId of createdUserIds) {
    await db.delete(users).where(eq(users.id, userId));
  }
  await pool.end();
});

describe("createGroceryListWithLimitCheck: concurrent multi-connection safety", () => {
  it("creates exactly one list when two creates race at maxLists - 1", async () => {
    for (let iter = 0; iter < 10; iter++) {
      const userId = await createCommittedUser();
      await db
        .insert(groceryLists)
        .values(
          Array.from({ length: MAX_LISTS - 1 }, (_, i) =>
            list(userId, `Seed ${i}`),
          ),
        );

      const results = await Promise.all([
        createGroceryListWithLimitCheck(list(userId, "Race A"), [], MAX_LISTS),
        createGroceryListWithLimitCheck(list(userId, "Race B"), [], MAX_LISTS),
      ]);

      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect(await committedCount(userId)).toBe(MAX_LISTS);
    }
  });
});
