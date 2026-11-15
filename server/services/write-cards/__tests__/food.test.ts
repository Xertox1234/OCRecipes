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
const chicken = {
  name: "Grilled chicken breast",
  count: 2,
  unitLabel: "100 g",
  estimate: { calories: 160, protein: 30, carbs: 0, fat: 4 },
};

// What the sources really return for a text query: values per 100 g.
const per100g = (v: {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}) => ({
  ...v,
  fiber: 0,
  sugar: 0,
  sodium: 0,
  servingSize: "100g",
  source: "usda" as const,
});

const chickenRow = per100g({
  name: "Chicken, breast, grilled",
  calories: 165,
  protein: 31,
  carbs: 0,
  fat: 3.6,
});

// The row USDA returned for "1 egg large egg" on 2026-11-15, as returned.
const eggWhiteRow = per100g({
  name: "Eggs, Grade A, Large, egg white",
  calories: 55,
  protein: 10.7,
  carbs: 2.36,
  fat: 0,
});

// 2026-11-09 16:00Z = 08:00 in Los Angeles
const morning = new Date("2026-11-09T16:00:00Z");

type Lookup = NonNullable<
  Parameters<typeof buildFoodPayload>[2]
>["lookupNutrition"];

const build = (item: typeof eggs, lookupNutrition: Lookup) =>
  buildFoodPayload(
    logFoodCardArgsSchema.parse({ items: [item] }),
    { tz: "UTC", now: morning },
    { lookupNutrition },
  );

describe("buildFoodPayload", () => {
  it("a unit that states its weight takes the lookup, scaled to that weight", async () => {
    const lookupNutrition = vi.fn<Lookup>(async () => chickenRow);
    const p = await build(chicken, lookupNutrition);
    expect(lookupNutrition).toHaveBeenCalledWith("Grilled chicken breast");
    expect(p.items[0]).toMatchObject({
      name: "Grilled chicken breast",
      unitLabel: "100 g",
      count: 2,
      source: "lookup",
      perUnit: { calories: 165, protein: 31, carbs: 0, fat: 3.6 },
    });
  });

  it("scales a per-100 g row to the unit's weight", async () => {
    const p = await build(
      {
        ...chicken,
        unitLabel: "serving (150 g)",
        estimate: { calories: 240, protein: 45, carbs: 0, fat: 6 },
      },
      vi.fn(async () => chickenRow),
    );
    expect(p.items[0]).toMatchObject({
      source: "lookup",
      perUnit: { calories: 248, protein: 46.5, carbs: 0, fat: 5.4 },
    });
  });

  it("a large egg keeps roughly 70 cal and 6 g protein, not the per-100 g egg-white row", async () => {
    const lookupNutrition = vi.fn<Lookup>(async () => eggWhiteRow);
    const p = await build(
      { ...eggs, name: "large egg", count: 2 },
      lookupNutrition,
    );
    expect(p.items[0]).toMatchObject({
      source: "estimate",
      perUnit: { calories: 70, protein: 6, carbs: 1, fat: 5 },
    });
    // A counted unit ("egg") has no weight to scale a per-100 g row to.
    expect(lookupNutrition).not.toHaveBeenCalled();
  });

  it("a row for a different food is refused even when its calories are close", async () => {
    // 100 g of whole egg asked for; the egg-white row answers. Calories are
    // within 3x, but the fat is gone and the protein is not the same food's.
    const p = await build(
      {
        name: "eggs",
        count: 1,
        unitLabel: "100 g",
        estimate: { calories: 143, protein: 12.6, carbs: 0.7, fat: 9.5 },
      },
      vi.fn(async () => eggWhiteRow),
    );
    expect(p.items[0].source).toBe("estimate");
  });

  it("a row whose macros do not add up to its calories is refused", async () => {
    const p = await build(
      chicken,
      vi.fn(async () =>
        per100g({
          name: "Chicken",
          calories: 165,
          protein: 10,
          carbs: 0,
          fat: 1,
        }),
      ),
    );
    expect(p.items[0]).toMatchObject({
      source: "estimate",
      perUnit: chicken.estimate,
    });
  });

  it("a row on a basis that cannot be weighed is refused", async () => {
    const p = await build(
      chicken,
      vi.fn(async () => ({ ...chickenRow, servingSize: "1 serving" })),
    );
    expect(p.items[0].source).toBe("estimate");
  });

  it("lookup miss keeps the estimate and marks source estimate", async () => {
    const p = await build(
      chicken,
      vi.fn(async () => null),
    );
    expect(p.items[0]).toMatchObject({
      source: "estimate",
      perUnit: chicken.estimate,
    });
  });

  it("a lookup that throws falls back to the estimate", async () => {
    const p = await build(
      chicken,
      vi.fn(async () => {
        throw new Error("upstream down");
      }),
    );
    expect(p.items[0].source).toBe("estimate");
  });

  it("a lookup wildly off the estimate is refused", async () => {
    const p = await build(
      chicken,
      vi.fn(async () =>
        per100g({
          name: "Chicken fat",
          calories: 900,
          protein: 0,
          carbs: 0,
          fat: 100,
        }),
      ),
    );
    expect(p.items[0]).toMatchObject({
      source: "estimate",
      perUnit: chicken.estimate,
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
