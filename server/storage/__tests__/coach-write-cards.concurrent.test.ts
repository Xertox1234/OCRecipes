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
import { users, userProfiles, chatConversations } from "@shared/schema";
import {
  createWriteCard,
  getWriteCard,
  saveWriteCard,
} from "../coach-write-cards";
import { getProfileAllergies, withdrawHealthConsent } from "../user-profiles";

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A card save locks the card row, then the profile row. A withdrawal that
 * updated the profile first and the user's allergy cards second took the same
 * two locks in the opposite order, so Postgres aborted one of the two with a
 * deadlock error. Both must take the card lock first. The save's `perform` is
 * held open after the card lock is taken, so the interleaving is the same on
 * every run.
 */

describe("allergy card save vs withdrawHealthConsent: concurrent multi-connection safety", () => {
  it("both finish when the withdrawal starts while a save holds the card", async () => {
    const [user] = await db
      .insert(users)
      .values({
        username: `card_concurrent_${crypto.randomUUID()}`,
        email: `card_concurrent_${crypto.randomUUID()}@test.invalid`,
        password: "hashed_password_placeholder",
      })
      .returning({ id: users.id });
    createdUserIds.push(user.id);
    await db
      .insert(userProfiles)
      .values({ userId: user.id, healthDataConsentAt: new Date() });
    const [conversation] = await db
      .insert(chatConversations)
      .values({ userId: user.id, title: "Coach", type: "coach" })
      .returning({ id: chatConversations.id });
    const { card } = await createWriteCard({
      userId: user.id,
      conversationId: conversation.id,
      kind: "allergy",
      payload: { allergen: "shellfish" },
    });

    let cardLocked!: () => void;
    const cardIsLocked = new Promise<void>((r) => (cardLocked = r));
    let release!: () => void;
    const released = new Promise<void>((r) => (release = r));

    const save = saveWriteCard(
      card.id,
      user.id,
      async (tx) => {
        cardLocked();
        await released;
        // What an allergy save does next: lock the profile row.
        await getProfileAllergies(user.id, tx, { forUpdate: true });
        return { allergyAdded: { name: "shellfish", severity: "severe" } };
      },
      { severity: "severe" },
    );
    await cardIsLocked;
    const withdrawal = withdrawHealthConsent(user.id);
    // Long enough for the withdrawal to take or queue for its first lock.
    await sleep(300);
    release();

    const results = await Promise.allSettled([save, withdrawal]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

    // The withdrawal ran last: the card is closed and holds no severity.
    const after = await getWriteCard(card.id, user.id);
    expect(after?.status).toBe("expired");
    expect(after?.edits).toEqual({});
    expect(after?.savedRefs).toBeNull();
  });
});
