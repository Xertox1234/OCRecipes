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
import type { PantryCardPayload } from "@shared/schemas/coach-write-cards";
import { createMockCoachWriteCard } from "../../../__tests__/factories";

vi.mock("../../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  planPantryCard,
  buildPantryPayload,
  performPantrySave,
  revertPantrySave,
  pantryReceipt,
  updatePantryCardArgsSchema,
} = await import("../pantry");
const { WriteCardEditError } = await import("../errors");
const { MAX_PANTRY_ITEMS } = await import("../../../storage/pantry");

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;

const stock = async (
  name: string,
  more: Partial<typeof schema.pantryItems.$inferInsert> = {},
  userId = user.id,
) => {
  const [row] = await tx
    .insert(schema.pantryItems)
    .values({ userId, name, ...more })
    .returning();
  return row;
};
const pantryOf = async (userId = user.id) =>
  (
    await tx
      .select()
      .from(schema.pantryItems)
      .where(eq(schema.pantryItems.userId, userId))
  ).sort((a, b) => a.name.localeCompare(b.name));
const names = async () => (await pantryOf()).map((r) => r.name);
const args = (changes: unknown[]) =>
  updatePantryCardArgsSchema.parse({ changes });
const card = (
  payload: PantryCardPayload,
  savedRefs?: schema.CoachWriteCardSavedRefs,
) =>
  createMockCoachWriteCard({
    userId: user.id,
    kind: "pantry",
    payload,
    ...(savedRefs && { savedRefs }),
  });
const NOW = new Date("2026-11-16T12:00:00Z");
const ctx = () => ({ userId: user.id, now: NOW });

describe("pantry write card", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    user = await createTestUser(tx);
    // The pantry is a paid feature, and the save checks the plan.
    await tx
      .update(schema.users)
      .set({ subscriptionTier: "premium" })
      .where(eq(schema.users.id, user.id));
  });
  afterEach(async () => {
    await rollbackTestTransaction();
  });
  afterAll(async () => {
    await closeTestPool();
  });

  describe("building the card", () => {
    it("an add is a new row, with its amount and expiry", async () => {
      const plan = await planPantryCard(
        args([
          { action: "add", name: "Eggs", quantity: "12", expiresInDays: 14 },
          { action: "add", name: "Salt" },
        ]),
        user.id,
      );
      expect(plan.dropped).toBe(0);
      expect(plan.payload?.rows).toEqual([
        {
          action: "add",
          name: "Eggs",
          quantity: "12",
          unit: null,
          itemId: null,
          held: null,
          all: false,
          expiresInDays: 14,
        },
        expect.objectContaining({ name: "Salt", quantity: null, itemId: null }),
      ]);
    });

    it("an add tops up a row with the same name and unit, when both have amounts", async () => {
      const milk = await stock("milk", { quantity: "1", unit: "L" });
      await stock("rice"); // no amount: cannot be topped up
      const plan = await planPantryCard(
        args([
          { action: "add", name: "Milk", quantity: "2", unit: "l" },
          { action: "add", name: "Rice", quantity: "500", unit: "g" },
        ]),
        user.id,
      );
      expect(plan.payload?.rows[0]).toMatchObject({
        action: "add",
        name: "milk",
        itemId: milk.id,
        held: "1.00",
        quantity: "2",
        unit: "L",
      });
      expect(plan.payload?.rows[1]).toMatchObject({
        name: "Rice",
        itemId: null,
      });
    });

    it("a use takes part of a row, or all of it when it must", async () => {
      const milk = await stock("Milk", { quantity: "2", unit: "L" });
      const rice = await stock("Rice", { quantity: "500", unit: "g" });
      const salt = await stock("Salt");
      const oil = await stock("Oil", { quantity: "1" });
      const plan = await planPantryCard(
        args([
          { action: "use", itemId: milk.id, quantity: "1" },
          { action: "use", itemId: rice.id, quantity: "900" },
          { action: "use", itemId: salt.id, quantity: "1" },
          { action: "use", itemId: oil.id, all: true },
        ]),
        user.id,
      );
      expect(
        plan.payload?.rows.map((r) => [r.name, r.all, r.quantity, r.held]),
      ).toEqual([
        ["Milk", false, "1", "2.00"],
        ["Rice", true, null, "500.00"],
        ["Salt", true, null, null],
        ["Oil", true, null, "1.00"],
      ]);
    });

    it("a remove shows what the row holds", async () => {
      const spinach = await stock("Spinach", { quantity: "1", unit: "bag" });
      const plan = await planPantryCard(
        args([{ action: "remove", itemId: spinach.id }]),
        user.id,
      );
      expect(plan.payload?.rows[0]).toMatchObject({
        action: "remove",
        name: "Spinach",
        itemId: spinach.id,
        held: "1.00",
        unit: "bag",
      });
    });

    it("drops a row that is not the user's, unknown, or named twice", async () => {
      const other = await createTestUser(tx);
      const theirs = await stock("Their milk", { quantity: "2" }, other.id);
      const mine = await stock("Milk", { quantity: "2" });
      const plan = await planPantryCard(
        args([
          { action: "remove", itemId: theirs.id },
          { action: "use", itemId: 999_999_999, all: true },
          { action: "use", itemId: mine.id, quantity: "1" },
          { action: "remove", itemId: mine.id },
        ]),
        user.id,
      );
      expect(plan.dropped).toBe(3);
      expect(plan.payload?.rows.map((r) => r.name)).toEqual(["Milk"]);
    });

    it("an amount too large for the pantry is dropped, and never tops a row past the limit", async () => {
      const rice = await stock("Rice", { quantity: "99999999", unit: "g" });
      const plan = await planPantryCard(
        args([
          { action: "add", name: "Eggs", quantity: "99999999999" },
          { action: "add", name: "Rice", quantity: "5", unit: "g" },
        ]),
        user.id,
      );
      expect(plan.payload?.rows[0]).toMatchObject({
        name: "Eggs",
        quantity: null,
      });
      // 99999999 + 5 would overflow the column: a new row, not a top-up.
      expect(plan.payload?.rows[1]).toMatchObject({
        name: "Rice",
        itemId: null,
        quantity: "5",
      });
      expect(rice.id).toBeGreaterThan(0);
    });

    it("with nothing left there is no card", async () => {
      const plan = await planPantryCard(
        args([{ action: "remove", itemId: 999_999_999 }]),
        user.id,
      );
      expect(plan).toEqual({ payload: null, dropped: 1 });
      await expect(
        buildPantryPayload(
          args([{ action: "remove", itemId: 999_999_999 }]),
          user.id,
        ),
      ).rejects.toBeInstanceOf(WriteCardEditError);
    });

    it("refuses a use with neither an amount nor all, and unsafe text", () => {
      expect(
        updatePantryCardArgsSchema.safeParse({
          changes: [{ action: "use", itemId: 1 }],
        }).success,
      ).toBe(false);
      expect(
        updatePantryCardArgsSchema.safeParse({ changes: [] }).success,
      ).toBe(false);
    });
  });

  describe("saving", () => {
    async function mixed() {
      const milk = await stock("Milk", { quantity: "2", unit: "L" });
      const rice = await stock("Rice", { quantity: "500", unit: "g" });
      const spinach = await stock("Spinach", {
        quantity: "1",
        unit: "bag",
        expiresAt: new Date("2026-11-20T00:00:00Z"),
      });
      const flour = await stock("Flour", { quantity: "1", unit: "kg" });
      const payload = await buildPantryPayload(
        args([
          { action: "add", name: "Eggs", quantity: "12", expiresInDays: 14 },
          { action: "add", name: "flour", quantity: "0.5", unit: "kg" },
          { action: "use", itemId: milk.id, quantity: "0.5" },
          { action: "use", itemId: rice.id, all: true },
          { action: "remove", itemId: spinach.id },
        ]),
        user.id,
      );
      return { milk, rice, spinach, flour, payload };
    }

    it("applies every ticked row and records what it did", async () => {
      const { milk, flour, payload } = await mixed();
      const refs = await performPantrySave(tx, card(payload), {}, ctx());
      const after = await pantryOf();
      expect(after.map((r) => [r.name, r.quantity])).toEqual([
        ["Eggs", "12.00"],
        ["Flour", "1.50"],
        ["Milk", "1.50"],
      ]);
      const eggs = after[0];
      expect(eggs.expiresAt?.toISOString()).toBe("2026-11-30T12:00:00.000Z");
      expect(refs.pantryAddedIds).toEqual([eggs.id]);
      expect(refs.pantryCounts).toEqual({
        added: 2,
        used: 2,
        removed: 1,
        skipped: 0,
      });
      expect(
        refs.pantryRestore?.map((c) => [c.id, c.deleted, c.after]),
      ).toEqual(
        expect.arrayContaining([
          [flour.id, false, "1.5"],
          [milk.id, false, "1.5"],
        ]),
      );
      expect(pantryReceipt(card(payload, refs))).toBe(
        "✓ Pantry updated · 2 added, 2 used, 1 removed",
      );
    });

    it("skips a row that changed, or went, after the card was built", async () => {
      const { milk, spinach, payload } = await mixed();
      await tx
        .update(schema.pantryItems)
        .set({ quantity: "5" })
        .where(eq(schema.pantryItems.id, milk.id));
      await tx
        .delete(schema.pantryItems)
        .where(eq(schema.pantryItems.id, spinach.id));
      const refs = await performPantrySave(tx, card(payload), {}, ctx());
      expect(refs.pantryCounts).toEqual({
        added: 2,
        used: 1,
        removed: 0,
        skipped: 2,
      });
      expect((await pantryOf()).find((r) => r.id === milk.id)?.quantity).toBe(
        "5.00",
      );
      expect(pantryReceipt(card(payload, refs))).toBe(
        "✓ Pantry updated · 2 added, 1 used · 2 skipped",
      );
    });

    it("leaves unticked rows alone, and refuses an empty save", async () => {
      const { payload } = await mixed();
      const refs = await performPantrySave(
        tx,
        card(payload),
        { ticked: [false, false, false, false, true] },
        ctx(),
      );
      expect(refs.pantryCounts).toEqual({
        added: 0,
        used: 0,
        removed: 1,
        skipped: 0,
      });
      expect(await names()).toEqual(["Flour", "Milk", "Rice"]);
      await expect(
        performPantrySave(
          tx,
          card(payload),
          { ticked: payload.rows.map(() => false) },
          ctx(),
        ),
      ).rejects.toBeInstanceOf(WriteCardEditError);
      await expect(
        performPantrySave(tx, card(payload), { ticked: [true] }, ctx()),
      ).rejects.toBeInstanceOf(WriteCardEditError);
    });

    it("never touches another user's row, whatever id the card holds", async () => {
      const other = await createTestUser(tx);
      const theirs = await stock("Their milk", { quantity: "2" }, other.id);
      const payload: PantryCardPayload = {
        rows: [
          {
            action: "remove",
            name: "Their milk",
            quantity: null,
            unit: null,
            itemId: theirs.id,
            held: "2.00",
            all: false,
            expiresInDays: null,
          },
        ],
      };
      const refs = await performPantrySave(tx, card(payload), {}, ctx());
      expect(refs.pantryCounts?.skipped).toBe(1);
      expect(await pantryOf(other.id)).toHaveLength(1);
    });

    it("adds only what fits under the pantry cap", async () => {
      await tx.insert(schema.pantryItems).values(
        Array.from({ length: MAX_PANTRY_ITEMS - 1 }, (_, i) => ({
          userId: user.id,
          name: `Item ${i}`,
        })),
      );
      const payload = await buildPantryPayload(
        args([
          { action: "add", name: "Eggs" },
          { action: "add", name: "Bread" },
        ]),
        user.id,
      );
      const refs = await performPantrySave(tx, card(payload), {}, ctx());
      expect(refs.pantryCounts).toMatchObject({ added: 1, skipped: 1 });
      expect(await pantryOf()).toHaveLength(MAX_PANTRY_ITEMS);
    });

    it("refuses the save once the plan no longer includes the pantry, but Undo still works", async () => {
      const milk = await stock("Milk", { quantity: "2" });
      const payload = await buildPantryPayload(
        args([{ action: "remove", itemId: milk.id }]),
        user.id,
      );
      const refs = await performPantrySave(tx, card(payload), {}, ctx());
      expect(await pantryOf()).toHaveLength(0);
      await tx
        .update(schema.users)
        .set({ subscriptionTier: "free" })
        .where(eq(schema.users.id, user.id));
      await expect(
        performPantrySave(tx, card(payload), {}, ctx()),
      ).rejects.toBeInstanceOf(WriteCardEditError);
      await revertPantrySave(
        tx,
        card(payload, JSON.parse(JSON.stringify(refs))),
      );
      expect(await names()).toEqual(["Milk"]);
    });

    it("says so when nothing could be changed", async () => {
      const milk = await stock("Milk", { quantity: "2" });
      const payload = await buildPantryPayload(
        args([{ action: "remove", itemId: milk.id }]),
        user.id,
      );
      await tx
        .delete(schema.pantryItems)
        .where(eq(schema.pantryItems.id, milk.id));
      const refs = await performPantrySave(tx, card(payload), {}, ctx());
      expect(pantryReceipt(card(payload, refs))).toBe(
        "✓ Nothing changed · 1 skipped",
      );
    });
  });

  describe("undo", () => {
    it("puts the pantry back as it was", async () => {
      const milk = await stock("Milk", { quantity: "2", unit: "L" });
      const spinach = await stock("Spinach", {
        quantity: "1",
        unit: "bag",
        category: "produce",
        expiresAt: new Date("2026-11-20T00:00:00Z"),
      });
      const payload = await buildPantryPayload(
        args([
          { action: "add", name: "Eggs", quantity: "12" },
          { action: "use", itemId: milk.id, quantity: "0.5" },
          { action: "remove", itemId: spinach.id },
        ]),
        user.id,
      );
      const refs = await performPantrySave(tx, card(payload), {}, ctx());
      // savedRefs is stored as JSON: dates come back as text.
      const stored = JSON.parse(JSON.stringify(refs));
      await revertPantrySave(tx, card(payload, stored));
      const after = await pantryOf();
      expect(after.map((r) => [r.name, r.quantity, r.unit])).toEqual([
        ["Milk", "2.00", "L"],
        ["Spinach", "1.00", "bag"],
      ]);
      const back = after[1];
      expect(back.category).toBe("produce");
      expect(back.expiresAt?.toISOString()).toBe("2026-11-20T00:00:00.000Z");
      expect(back.userId).toBe(user.id);
    });

    it("a card saved, undone and saved again still applies every row", async () => {
      const milk = await stock("Milk", { quantity: "2", unit: "L" });
      const spinach = await stock("Spinach", { quantity: "1", unit: "bag" });
      const rice = await stock("Rice", { quantity: "500", unit: "g" });
      const payload = await buildPantryPayload(
        args([
          { action: "use", itemId: milk.id, quantity: "0.5" },
          { action: "remove", itemId: spinach.id },
          { action: "use", itemId: rice.id, all: true },
        ]),
        user.id,
      );
      const first = await performPantrySave(tx, card(payload), {}, ctx());
      await revertPantrySave(
        tx,
        card(payload, JSON.parse(JSON.stringify(first))),
      );
      // Undo puts the removed rows back as the same rows the card names.
      expect((await pantryOf()).map((r) => r.id).sort()).toEqual(
        [milk.id, spinach.id, rice.id].sort(),
      );
      const second = await performPantrySave(tx, card(payload), {}, ctx());
      expect(second.pantryCounts).toEqual({
        added: 0,
        used: 2,
        removed: 1,
        skipped: 0,
      });
      expect((await pantryOf()).map((r) => [r.name, r.quantity])).toEqual([
        ["Milk", "1.50"],
      ]);
    });

    it("a use amount that cannot be read is dropped, never turned into use all", async () => {
      const milk = await stock("Milk", { quantity: "2", unit: "L" });
      const oil = await stock("Oil", { quantity: "1" });
      const plan = await planPantryCard(
        args([
          { action: "use", itemId: milk.id, quantity: "half" },
          { action: "use", itemId: oil.id, quantity: "-1" },
        ]),
        user.id,
      );
      expect(plan).toEqual({ payload: null, dropped: 2 });
      expect(await names()).toEqual(["Milk", "Oil"]);
    });

    it("leaves a row the user changed after the save", async () => {
      const milk = await stock("Milk", { quantity: "2" });
      const payload = await buildPantryPayload(
        args([{ action: "use", itemId: milk.id, quantity: "0.5" }]),
        user.id,
      );
      const refs = await performPantrySave(tx, card(payload), {}, ctx());
      await tx
        .update(schema.pantryItems)
        .set({ quantity: "9" })
        .where(eq(schema.pantryItems.id, milk.id));
      await revertPantrySave(
        tx,
        card(payload, JSON.parse(JSON.stringify(refs))),
      );
      expect((await pantryOf())[0].quantity).toBe("9.00");
    });

    it("puts back only what still fits under the cap", async () => {
      const milk = await stock("Milk", { quantity: "2" });
      const payload = await buildPantryPayload(
        args([{ action: "remove", itemId: milk.id }]),
        user.id,
      );
      const refs = await performPantrySave(tx, card(payload), {}, ctx());
      await tx.insert(schema.pantryItems).values(
        Array.from({ length: MAX_PANTRY_ITEMS }, (_, i) => ({
          userId: user.id,
          name: `Item ${i}`,
        })),
      );
      await revertPantrySave(
        tx,
        card(payload, JSON.parse(JSON.stringify(refs))),
      );
      expect(await pantryOf()).toHaveLength(MAX_PANTRY_ITEMS);
    });
  });
});
