import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import type { FoodCardPayload } from "@shared/schemas/coach-write-cards";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  createWriteCard,
  getWriteCard,
  getLiveWriteCard,
  setWriteCardEdits,
  saveWriteCard,
  undoWriteCard,
  getWriteCardsByIds,
  undoWindowOpen,
} = await import("../coach-write-cards");

const foodPayload: FoodCardPayload = {
  items: [
    {
      name: "Large eggs",
      unitLabel: "egg",
      perUnit: { calories: 72, protein: 6, carbs: 0, fat: 5 },
      count: 2,
      source: "lookup",
    },
  ],
  mealType: "breakfast",
  day: "today",
};
const groceryPayload = {
  items: [{ name: "Spinach", quantity: "1", unit: "bag", ticked: true }],
  lists: [],
  defaultListId: null,
  newListName: "Coach list",
};

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;
let conversationId: number;

async function liveCount(): Promise<number> {
  const rows = await tx
    .select()
    .from(schema.coachWriteCards)
    .where(
      and(
        eq(schema.coachWriteCards.conversationId, conversationId),
        eq(schema.coachWriteCards.status, "live"),
      ),
    );
  return rows.length;
}

describe("coach-write-cards storage", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    user = await createTestUser(tx);
    const [conv] = await tx
      .insert(schema.chatConversations)
      .values({ userId: user.id, title: "Coach", type: "coach" })
      .returning();
    conversationId = conv.id;
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  const create = (kind: "food" | "grocery" = "food") =>
    createWriteCard({
      userId: user.id,
      conversationId,
      kind,
      payload: kind === "food" ? foodPayload : groceryPayload,
    });

  it("createWriteCard replaces a same-kind live card", async () => {
    const first = await create();
    const second = await create();
    expect(second.previous).toEqual({ id: first.card.id, status: "replaced" });
    expect((await getWriteCard(first.card.id, user.id))?.status).toBe(
      "replaced",
    );
    expect(await liveCount()).toBe(1);
    expect((await getLiveWriteCard(conversationId, user.id))?.id).toBe(
      second.card.id,
    );
  });

  it("createWriteCard expires a different-kind live card", async () => {
    const first = await create("food");
    const second = await create("grocery");
    expect(second.previous).toEqual({ id: first.card.id, status: "expired" });
    expect(await liveCount()).toBe(1);
  });

  it("createWriteCard with no live card reports no previous", async () => {
    const first = await create();
    expect(first.previous).toBeNull();
    expect(first.card.status).toBe("live");
  });

  it("setWriteCardEdits updates only a live card", async () => {
    const first = await create();
    expect(
      await setWriteCardEdits(first.card.id, user.id, { counts: [3] }),
    ).toBe(true);
    expect((await getWriteCard(first.card.id, user.id))?.edits).toEqual({
      counts: [3],
    });
    await create();
    expect(
      await setWriteCardEdits(first.card.id, user.id, { counts: [4] }),
    ).toBe(false);
  });

  it("saveWriteCard runs perform once and stores refs", async () => {
    const { card } = await create();
    const perform = vi.fn(async () => ({ scannedItemIds: [11, 12] }));
    const result = await saveWriteCard(card.id, user.id, perform);
    expect(result.status).toBe("saved");
    expect(perform).toHaveBeenCalledTimes(1);
    const saved = await getWriteCard(card.id, user.id);
    expect(saved?.status).toBe("saved");
    expect(saved?.savedRefs).toEqual({ scannedItemIds: [11, 12] });
    expect(saved?.savedAt).toBeInstanceOf(Date);

    const again = await saveWriteCard(card.id, user.id, perform);
    expect(again.status).toBe("already_saved");
    expect(perform).toHaveBeenCalledTimes(1);
  });

  it("saveWriteCard stores the edits it saved with, and keeps them when none are given", async () => {
    const a = await create();
    await setWriteCardEdits(a.card.id, user.id, { counts: [3] });
    await saveWriteCard(a.card.id, user.id, async () => ({}), { counts: [4] });
    expect((await getWriteCard(a.card.id, user.id))?.edits).toEqual({
      counts: [4],
    });
    const b = await create();
    await setWriteCardEdits(b.card.id, user.id, { counts: [5] });
    await saveWriteCard(b.card.id, user.id, async () => ({}));
    expect((await getWriteCard(b.card.id, user.id))?.edits).toEqual({
      counts: [5],
    });
  });

  it("saveWriteCard refuses a replaced card", async () => {
    const { card } = await create();
    await create();
    const perform = vi.fn(async () => ({}));
    const result = await saveWriteCard(card.id, user.id, perform);
    expect(result.status).toBe("locked");
    expect(perform).not.toHaveBeenCalled();
  });

  it("saveWriteCard leaves the card live when perform throws", async () => {
    const { card } = await create();
    await expect(
      saveWriteCard(card.id, user.id, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect((await getWriteCard(card.id, user.id))?.status).toBe("live");
  });

  // The whole path on a real database: the kind check accepts 'goals'
  // (migration 0050), the save writes the user's goals, Undo puts them back.
  it("a goals card saves the user's goals and Undo restores them", async () => {
    const { performWriteCardSave, revertWriteCardSave } = await import(
      "../../services/write-cards"
    );
    const goalOf = async () =>
      (
        await tx
          .select({ calories: schema.users.dailyCalorieGoal })
          .from(schema.users)
          .where(eq(schema.users.id, user.id))
      )[0].calories;
    await tx
      .update(schema.users)
      .set({ dailyCalorieGoal: 1800 })
      .where(eq(schema.users.id, user.id));
    const { card } = await createWriteCard({
      userId: user.id,
      conversationId,
      kind: "goals",
      payload: {
        rows: [{ key: "calories", current: 1800, proposed: 2000 }],
      },
    });
    const ctx = { userId: user.id, tz: "UTC", now: new Date() };
    const saved = await saveWriteCard(
      card.id,
      user.id,
      (t, c) => performWriteCardSave(t, c, { values: [2100] }, ctx),
      { values: [2100] },
    );
    expect(saved.status).toBe("saved");
    expect(await goalOf()).toBe(2100);
    expect((await getWriteCard(card.id, user.id))?.savedRefs).toEqual({
      goalsRestore: [{ key: "calories", before: 1800, after: 2100 }],
    });

    const undone = await undoWriteCard(card.id, user.id, (t, c) =>
      revertWriteCardSave(t, c),
    );
    expect(undone.status).toBe("undone");
    expect(await goalOf()).toBe(1800);
  });

  // The whole path on a real database for the allergy card: the kind check
  // accepts 'allergy', the save adds it to the profile, Undo removes it.
  it("an allergy card adds the allergy and Undo removes it", async () => {
    const { performWriteCardSave, revertWriteCardSave } = await import(
      "../../services/write-cards"
    );
    await tx.insert(schema.userProfiles).values({
      userId: user.id,
      allergies: [{ name: "milk", severity: "mild" }],
      healthDataConsentAt: new Date(),
    });
    const allergiesOf = async () =>
      (
        await tx
          .select({ allergies: schema.userProfiles.allergies })
          .from(schema.userProfiles)
          .where(eq(schema.userProfiles.userId, user.id))
      )[0].allergies;
    const { card } = await createWriteCard({
      userId: user.id,
      conversationId,
      kind: "allergy",
      payload: { allergen: "shellfish" },
    });
    const ctx = { userId: user.id, tz: "UTC", now: new Date() };
    const saved = await saveWriteCard(
      card.id,
      user.id,
      (t, c) => performWriteCardSave(t, c, { severity: "severe" }, ctx),
      { severity: "severe" },
    );
    expect(saved.status).toBe("saved");
    expect(await allergiesOf()).toEqual([
      { name: "milk", severity: "mild" },
      { name: "shellfish", severity: "severe" },
    ]);

    const undone = await undoWriteCard(card.id, user.id, (t, c) =>
      revertWriteCardSave(t, c),
    );
    expect(undone.status).toBe("undone");
    expect(await allergiesOf()).toEqual([{ name: "milk", severity: "mild" }]);
  });

  // Health-data consent withdrawn: an allergy card is a structured allergy
  // record (allergen in the payload, severity in the edits and refs), so the
  // withdrawal closes every allergy card and blanks what the user chose.
  it("withdrawing health consent expires allergy cards and clears their severity", async () => {
    const { withdrawHealthConsent } = await import("../user-profiles");
    await tx.insert(schema.userProfiles).values({
      userId: user.id,
      allergies: [{ name: "shellfish", severity: "severe" }],
      healthDataConsentAt: new Date(),
    });
    const allergy = () =>
      createWriteCard({
        userId: user.id,
        conversationId,
        kind: "allergy",
        payload: { allergen: "shellfish" },
      });
    const { card: savedCard } = await allergy();
    await saveWriteCard(
      savedCard.id,
      user.id,
      async () => ({
        allergyAdded: { name: "shellfish", severity: "severe" },
      }),
      { severity: "severe" },
    );
    const { card: liveCard } = await allergy();
    await setWriteCardEdits(liveCard.id, user.id, { severity: "mild" });
    const { card: foodCard } = await createWriteCard({
      userId: user.id,
      conversationId: (
        await tx
          .insert(schema.chatConversations)
          .values({ userId: user.id, title: "Other", type: "coach" })
          .returning()
      )[0].id,
      kind: "food",
      payload: foodPayload,
    });

    await withdrawHealthConsent(user.id);

    for (const id of [savedCard.id, liveCard.id]) {
      const after = await getWriteCard(id, user.id);
      expect(after?.status).toBe("expired");
      expect(after?.edits).toEqual({});
      expect(after?.savedRefs).toBeNull();
    }
    // Other kinds are not health records and are left alone.
    expect((await getWriteCard(foodCard.id, user.id))?.status).toBe("live");
  });

  it("undo within 60s reverts and returns card to live", async () => {
    const { card } = await create();
    await saveWriteCard(card.id, user.id, async () => ({
      scannedItemIds: [1],
    }));
    const saved = await getWriteCard(card.id, user.id);
    const revert = vi.fn(async () => {});
    const result = await undoWriteCard(
      card.id,
      user.id,
      revert,
      new Date(saved!.savedAt!.getTime() + 59_000),
    );
    expect(result.status).toBe("undone");
    expect(revert).toHaveBeenCalledTimes(1);
    const after = await getWriteCard(card.id, user.id);
    expect(after?.status).toBe("live");
    expect(after?.savedRefs).toBeNull();
    expect(after?.savedAt).toBeNull();
  });

  it("undo after 61s is too_late", async () => {
    const { card } = await create();
    await saveWriteCard(card.id, user.id, async () => ({}));
    const saved = await getWriteCard(card.id, user.id);
    const revert = vi.fn(async () => {});
    const result = await undoWriteCard(
      card.id,
      user.id,
      revert,
      new Date(saved!.savedAt!.getTime() + 61_000),
    );
    expect(result.status).toBe("too_late");
    expect(revert).not.toHaveBeenCalled();
  });

  // Coach roadmap T2: a log applied at once was never tapped, so the user
  // may only notice it a while later. It keeps Undo for 5 minutes.
  it("a log applied at once can be undone for 5 minutes, then too_late", async () => {
    const { card } = await create();
    await saveWriteCard(card.id, user.id, async () => ({
      scannedItemIds: [],
      loggedAtOnce: true,
    }));
    const saved = await getWriteCard(card.id, user.id);
    const at = (ms: number) => new Date(saved!.savedAt!.getTime() + ms);
    expect(undoWindowOpen(saved!, at(4 * 60_000))).toBe(true);
    expect(undoWindowOpen(saved!, at(5 * 60_000 + 1))).toBe(false);
    const revert = vi.fn(async () => {});
    expect(
      (await undoWriteCard(card.id, user.id, revert, at(6 * 60_000))).status,
    ).toBe("too_late");
    expect(revert).not.toHaveBeenCalled();
    expect(
      (await undoWriteCard(card.id, user.id, revert, at(4 * 60_000))).status,
    ).toBe("undone");
    expect(revert).toHaveBeenCalledTimes(1);
  });

  it("a tapped save keeps the 60 s window", async () => {
    const { card } = await create();
    await saveWriteCard(card.id, user.id, async () => ({}));
    const saved = await getWriteCard(card.id, user.id);
    const at = (ms: number) => new Date(saved!.savedAt!.getTime() + ms);
    expect(undoWindowOpen(saved!, at(59_000))).toBe(true);
    expect(undoWindowOpen(saved!, at(61_000))).toBe(false);
  });

  it("undo of a live card is not_saved", async () => {
    const { card } = await create();
    const result = await undoWriteCard(card.id, user.id, async () => {});
    expect(result.status).toBe("not_saved");
  });

  it("undo returns card to expired when a newer card exists", async () => {
    const { card } = await create();
    await saveWriteCard(card.id, user.id, async () => ({}));
    const newer = await create("grocery");
    expect(newer.previous).toBeNull(); // a saved card is not live
    const result = await undoWriteCard(card.id, user.id, async () => {});
    expect(result.status).toBe("undone");
    expect((await getWriteCard(card.id, user.id))?.status).toBe("expired");
    expect(await liveCount()).toBe(1);
  });

  it("getWriteCard of another user's card is undefined", async () => {
    const { card } = await create();
    const other = await createTestUser(tx);
    expect(await getWriteCard(card.id, other.id)).toBeUndefined();
    const perform = vi.fn(async () => ({}));
    expect((await saveWriteCard(card.id, other.id, perform)).status).toBe(
      "not_found",
    );
    expect(perform).not.toHaveBeenCalled();
  });

  it("getWriteCardsByIds returns only the user's cards", async () => {
    const a = await create();
    const b = await create();
    const rows = await getWriteCardsByIds(user.id, [a.card.id, b.card.id]);
    expect(rows.map((r) => r.id).sort()).toEqual([a.card.id, b.card.id].sort());
    const other = await createTestUser(tx);
    expect(await getWriteCardsByIds(other.id, [a.card.id])).toEqual([]);
    expect(await getWriteCardsByIds(user.id, [])).toEqual([]);
  });
});
