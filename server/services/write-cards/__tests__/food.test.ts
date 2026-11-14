import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import type { FoodCardPayload } from "@shared/schemas/coach-write-cards";
import { createMockCoachWriteCard } from "../../../__tests__/factories";

vi.mock("../../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  buildFoodPayload,
  performFoodSave,
  revertFoodSave,
  logFoodCardArgsSchema,
} = await import("../food");
const { WriteCardEditError } = await import("../errors");

const eggs = {
  name: "Large eggs",
  count: 2,
  unitLabel: "egg",
  estimate: { calories: 70, protein: 6, carbs: 1, fat: 5 },
};
const toast = {
  name: "Whole-wheat toast",
  count: 1,
  unitLabel: "slice",
  estimate: { calories: 80, protein: 4, carbs: 14, fat: 1 },
};

const hit = (calories: number) => ({
  name: "egg",
  calories,
  protein: 6.3,
  carbs: 0.4,
  fat: 4.8,
  fiber: 0,
  sugar: 0,
  sodium: 0,
  servingSize: "1 large",
  source: "usda" as const,
});

// 2026-11-09 16:00Z = 08:00 in Los Angeles
const morning = new Date("2026-11-09T16:00:00Z");

describe("buildFoodPayload", () => {
  it("lookup hit replaces the model estimate", async () => {
    const lookupNutrition = vi.fn(async () => hit(72));
    const p = await buildFoodPayload(
      logFoodCardArgsSchema.parse({ items: [eggs] }),
      { tz: "America/Los_Angeles", now: morning },
      { lookupNutrition },
    );
    expect(lookupNutrition).toHaveBeenCalledWith("1 egg Large eggs");
    expect(p.items[0]).toMatchObject({
      name: "Large eggs",
      unitLabel: "egg",
      count: 2,
      source: "lookup",
      perUnit: { calories: 72, protein: 6.3, carbs: 0.4, fat: 4.8 },
    });
  });

  it("lookup miss keeps the estimate and marks source estimate", async () => {
    const p = await buildFoodPayload(
      logFoodCardArgsSchema.parse({ items: [toast] }),
      { tz: "UTC", now: morning },
      { lookupNutrition: vi.fn(async () => null) },
    );
    expect(p.items[0]).toMatchObject({
      source: "estimate",
      perUnit: toast.estimate,
    });
  });

  it("a lookup that throws falls back to the estimate", async () => {
    const p = await buildFoodPayload(
      logFoodCardArgsSchema.parse({ items: [toast] }),
      { tz: "UTC", now: morning },
      {
        lookupNutrition: vi.fn(async () => {
          throw new Error("upstream down");
        }),
      },
    );
    expect(p.items[0].source).toBe("estimate");
  });

  it("a lookup wildly off the estimate is treated as a different basis", async () => {
    // e.g. a per-100 g row for a one-egg question
    const p = await buildFoodPayload(
      logFoodCardArgsSchema.parse({ items: [eggs] }),
      { tz: "UTC", now: morning },
      { lookupNutrition: vi.fn(async () => hit(520)) },
    );
    expect(p.items[0]).toMatchObject({
      source: "estimate",
      perUnit: eggs.estimate,
    });
  });

  it("meal defaults from local time", async () => {
    const none = { lookupNutrition: vi.fn(async () => null) };
    const args = logFoodCardArgsSchema.parse({ items: [eggs] });
    const la = "America/Los_Angeles";
    expect(
      (await buildFoodPayload(args, { tz: la, now: morning }, none)).mealType,
    ).toBe("breakfast");
    // 2026-11-10 02:30Z = 18:30 in Los Angeles
    const evening = new Date("2026-11-10T02:30:00Z");
    expect(
      (await buildFoodPayload(args, { tz: la, now: evening }, none)).mealType,
    ).toBe("dinner");
  });

  it("an explicit meal and day win", async () => {
    const p = await buildFoodPayload(
      logFoodCardArgsSchema.parse({
        items: [eggs],
        mealType: "snack",
        day: "yesterday",
      }),
      { tz: "UTC", now: morning },
      { lookupNutrition: vi.fn(async () => null) },
    );
    expect(p).toMatchObject({ mealType: "snack", day: "yesterday" });
  });

  it("tool args reject a count over 20 and more than 8 items", () => {
    expect(
      logFoodCardArgsSchema.safeParse({ items: [{ ...eggs, count: 21 }] })
        .success,
    ).toBe(false);
    expect(
      logFoodCardArgsSchema.safeParse({ items: Array(9).fill(eggs) }).success,
    ).toBe(false);
  });
});

describe("performFoodSave / revertFoodSave", () => {
  let tx: NodePgDatabase<typeof schema>;
  let user: schema.User;

  const payload: FoodCardPayload = {
    items: [
      {
        name: "Large eggs",
        unitLabel: "egg",
        perUnit: { calories: 72, protein: 6, carbs: 0.5, fat: 5 },
        count: 2,
        source: "lookup",
      },
      {
        name: "Whole-wheat toast",
        unitLabel: "slice",
        perUnit: { calories: 82, protein: 4, carbs: 14, fat: 1 },
        count: 1,
        source: "estimate",
      },
    ],
    mealType: "breakfast",
    day: "today",
  };

  const card = (p: FoodCardPayload = payload) =>
    createMockCoachWriteCard({ userId: user.id, kind: "food", payload: p });

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

  const logsFor = () =>
    tx
      .select({
        servings: schema.dailyLogs.servings,
        mealType: schema.dailyLogs.mealType,
        source: schema.dailyLogs.source,
        loggedAt: schema.dailyLogs.loggedAt,
        productName: schema.scannedItems.productName,
        calories: schema.scannedItems.calories,
        sourceType: schema.scannedItems.sourceType,
        servingSize: schema.scannedItems.servingSize,
      })
      .from(schema.dailyLogs)
      .innerJoin(
        schema.scannedItems,
        eq(schema.scannedItems.id, schema.dailyLogs.scannedItemId),
      )
      .where(
        and(
          eq(schema.dailyLogs.userId, user.id),
          isNull(schema.scannedItems.discardedAt),
        ),
      );

  it("save writes one entry per kept item with servings = count", async () => {
    const refs = await performFoodSave(
      tx,
      card(),
      { counts: [3, 0], mealType: "lunch" },
      { userId: user.id, now: new Date() },
    );
    expect(refs.scannedItemIds).toHaveLength(1);
    const logs = await logsFor();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      productName: "Large eggs",
      servingSize: "egg",
      calories: "72.00",
      sourceType: "coach",
      source: "coach",
      mealType: "lunch",
      servings: "3.00",
    });
  });

  it("yesterday stamps occurredAt 24h earlier", async () => {
    const now = new Date("2026-11-09T18:00:00Z");
    await performFoodSave(
      tx,
      card(),
      { day: "yesterday" },
      { userId: user.id, now },
    );
    const logs = await logsFor();
    expect(logs).toHaveLength(2);
    for (const l of logs) {
      expect(l.loggedAt.toISOString()).toBe("2026-11-08T18:00:00.000Z");
    }
  });

  it("save ignores calories in edits", async () => {
    await expect(
      performFoodSave(
        tx,
        card(),
        { calories: 1 },
        { userId: user.id, now: new Date() },
      ),
    ).rejects.toBeInstanceOf(WriteCardEditError);
    expect(await logsFor()).toHaveLength(0);
  });

  it("edits whose counts length does not match the items are rejected", async () => {
    await expect(
      performFoodSave(
        tx,
        card(),
        { counts: [1] },
        { userId: user.id, now: new Date() },
      ),
    ).rejects.toBeInstanceOf(WriteCardEditError);
  });

  it("saving nothing (every count 0) is rejected", async () => {
    await expect(
      performFoodSave(
        tx,
        card(),
        { counts: [0, 0] },
        { userId: user.id, now: new Date() },
      ),
    ).rejects.toBeInstanceOf(WriteCardEditError);
  });

  it("revert soft-deletes exactly the saved entries", async () => {
    const refs = await performFoodSave(
      tx,
      card(),
      {},
      { userId: user.id, now: new Date() },
    );
    await revertFoodSave(
      tx,
      createMockCoachWriteCard({
        userId: user.id,
        kind: "food",
        payload,
        savedRefs: refs,
      }),
    );
    expect(await logsFor()).toHaveLength(0);
  });
});
