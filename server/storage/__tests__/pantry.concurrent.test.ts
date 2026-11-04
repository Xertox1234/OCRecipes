/**
 * Multi-connection concurrency test for the pantry cap.
 *
 * Like `nutrition.concurrent.test.ts`, this does NOT mock `../../db` or use the
 * savepoint harness (both force a single connection, which cannot race).
 * Parallel calls check out distinct pool connections, so each is a genuine
 * separate transaction. Without the advisory lock, READ COMMITTED lets two
 * calls both see room and both insert, landing the user over the cap.
 *
 * Rows are committed and cleaned up in `afterAll` (pantry_items cascades from
 * users on delete).
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import crypto from "node:crypto";
import { db, pool } from "../../db";
import { users, pantryItems, type InsertPantryItem } from "@shared/schema";
import { createPantryItemsUnderCap, MAX_PANTRY_ITEMS } from "../pantry";

const createdUserIds: string[] = [];

async function createCommittedUser(): Promise<string> {
  const [user] = await db
    .insert(users)
    .values({
      username: `pantry_concurrent_${crypto.randomUUID()}`,
      email: `pantry_concurrent_${crypto.randomUUID()}@test.invalid`,
      password: "hashed_password_placeholder",
    })
    .returning({ id: users.id });
  createdUserIds.push(user.id);
  return user.id;
}

async function committedCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(pantryItems)
    .where(eq(pantryItems.userId, userId));
  return row.count;
}

const row = (userId: string, name: string): InsertPantryItem => ({
  userId,
  name,
  quantity: "1",
});

afterAll(async () => {
  for (const userId of createdUserIds) {
    await db.delete(users).where(eq(users.id, userId));
  }
  await pool.end();
});

describe("createPantryItemsUnderCap: concurrent multi-connection safety", () => {
  it("never exceeds the cap when single inserts race at the boundary", async () => {
    for (let iter = 0; iter < 10; iter++) {
      const userId = await createCommittedUser();
      await db
        .insert(pantryItems)
        .values(
          Array.from({ length: MAX_PANTRY_ITEMS - 1 }, (_, i) =>
            row(userId, `Seed ${i}`),
          ),
        );

      const results = await Promise.all([
        createPantryItemsUnderCap(userId, [row(userId, "Race A")]),
        createPantryItemsUnderCap(userId, [row(userId, "Race B")]),
      ]);

      const added = results.reduce((n, r) => n + r.created.length, 0);
      const skipped = results.reduce((n, r) => n + r.skipped, 0);
      expect(added).toBe(1);
      expect(skipped).toBe(1);
      expect(await committedCount(userId)).toBe(MAX_PANTRY_ITEMS);
    }
  });

  it("never exceeds the cap when batches race", async () => {
    const userId = await createCommittedUser();
    await db
      .insert(pantryItems)
      .values(
        Array.from({ length: MAX_PANTRY_ITEMS - 5 }, (_, i) =>
          row(userId, `Seed ${i}`),
        ),
      );

    const batch = (tag: string) =>
      Array.from({ length: 4 }, (_, i) => row(userId, `${tag} ${i}`));
    const results = await Promise.all([
      createPantryItemsUnderCap(userId, batch("A")),
      createPantryItemsUnderCap(userId, batch("B")),
      createPantryItemsUnderCap(userId, batch("C")),
    ]);

    const added = results.reduce((n, r) => n + r.created.length, 0);
    expect(added).toBe(5);
    expect(await committedCount(userId)).toBe(MAX_PANTRY_ITEMS);
  });
});
