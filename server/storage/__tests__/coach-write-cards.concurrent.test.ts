/**
 * Multi-connection test for the write-card save (Review Focus 1: a double
 * tap). Like `grocery-lists.concurrent.test.ts`, this does NOT mock
 * `../../db`: the savepoint harness forces one connection, which cannot race.
 * Rows are committed and removed in `afterAll` (cards cascade from users).
 */
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { db, pool } from "../../db";
import { users, chatConversations } from "@shared/schema";
import { createWriteCard, saveWriteCard } from "../coach-write-cards";

const createdUserIds: string[] = [];

afterAll(async () => {
  for (const id of createdUserIds) {
    await db.delete(users).where(eq(users.id, id));
  }
  await pool.end();
});

describe("saveWriteCard: concurrent multi-connection safety", () => {
  it("saveWriteCard is idempotent under concurrent calls", async () => {
    const [user] = await db
      .insert(users)
      .values({
        username: `write_card_concurrent_${crypto.randomUUID()}`,
        email: `write_card_concurrent_${crypto.randomUUID()}@test.invalid`,
        password: "hashed_password_placeholder",
      })
      .returning({ id: users.id });
    createdUserIds.push(user.id);
    const [conv] = await db
      .insert(chatConversations)
      .values({ userId: user.id, title: "Coach", type: "coach" })
      .returning();

    for (let iter = 0; iter < 5; iter++) {
      const { card } = await createWriteCard({
        userId: user.id,
        conversationId: conv.id,
        kind: "grocery",
        payload: {
          items: [
            { name: "Spinach", quantity: null, unit: null, ticked: true },
          ],
          lists: [],
          defaultListId: null,
          newListName: "Coach list",
        },
      });
      let performed = 0;
      const perform = async () => {
        performed += 1;
        // Hold the row lock long enough for the other call to queue on it.
        await new Promise((r) => setTimeout(r, 50));
        return { groceryItemIds: [iter] };
      };
      const results = await Promise.all([
        saveWriteCard(card.id, user.id, perform),
        saveWriteCard(card.id, user.id, perform),
      ]);
      expect(performed).toBe(1);
      expect(results.map((r) => r.status).sort()).toEqual([
        "already_saved",
        "saved",
      ]);
    }
  });
});
