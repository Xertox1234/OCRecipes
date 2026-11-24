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
import {
  goalsCardPayloadSchema,
  type GoalsCardPayload,
} from "@shared/schemas/coach-write-cards";
import { createMockCoachWriteCard } from "../../../__tests__/factories";

vi.mock("../../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  buildGoalsPayload,
  performGoalsSave,
  revertGoalsSave,
  describeGoals,
  setGoalsCardArgsSchema,
} = await import("../goals");
const { WriteCardEditError } = await import("../errors");

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;

const setGoals = (goals: Partial<typeof schema.users.$inferInsert>) =>
  tx.update(schema.users).set(goals).where(eq(schema.users.id, user.id));
const goalsOf = async () => {
  const [row] = await tx
    .select({
      calories: schema.users.dailyCalorieGoal,
      protein: schema.users.dailyProteinGoal,
      carbs: schema.users.dailyCarbsGoal,
      fat: schema.users.dailyFatGoal,
    })
    .from(schema.users)
    .where(eq(schema.users.id, user.id));
  return row;
};
const cardFor = (payload: GoalsCardPayload, savedRefs = {}) =>
  createMockCoachWriteCard({
    userId: user.id,
    kind: "goals",
    payload,
    savedRefs,
  });

beforeEach(async () => {
  tx = await setupTestTransaction();
  user = await createTestUser(tx);
  await setGoals({
    dailyCalorieGoal: 1800,
    dailyProteinGoal: 100,
    dailyCarbsGoal: null,
    dailyFatGoal: 60,
  });
});
afterEach(async () => {
  await rollbackTestTransaction();
});
afterAll(async () => {
  await closeTestPool();
});

describe("setGoalsCardArgsSchema", () => {
  it("needs at least one goal", () => {
    expect(setGoalsCardArgsSchema.safeParse({}).success).toBe(false);
    expect(setGoalsCardArgsSchema.safeParse({ protein: 150 }).success).toBe(
      true,
    );
  });

  it("refuses calories under the 1,200 floor and values past the bounds", () => {
    expect(setGoalsCardArgsSchema.safeParse({ calories: 1100 }).success).toBe(
      false,
    );
    expect(setGoalsCardArgsSchema.safeParse({ calories: 10001 }).success).toBe(
      false,
    );
    expect(setGoalsCardArgsSchema.safeParse({ protein: 501 }).success).toBe(
      false,
    );
    expect(setGoalsCardArgsSchema.safeParse({ fat: -1 }).success).toBe(false);
  });
});

describe("buildGoalsPayload", () => {
  it("makes one row per proposed goal, with the user's current value", async () => {
    const payload = await buildGoalsPayload(
      { calories: 2000, carbs: 250 },
      user.id,
    );
    expect(payload.rows).toEqual([
      { key: "calories", current: 1800, proposed: 2000 },
      { key: "carbs", current: null, proposed: 250 },
    ]);
    expect(goalsCardPayloadSchema.safeParse(payload).success).toBe(true);
  });

  it("rounds to the stepper's grid and keeps calories at the floor", async () => {
    const payload = await buildGoalsPayload(
      { calories: 1210, protein: 152.4 },
      user.id,
    );
    expect(payload.rows).toEqual([
      { key: "calories", current: 1800, proposed: 1200 },
      { key: "protein", current: 100, proposed: 150 },
    ]);
  });

  it("leaves out a goal that would not change, and refuses a card with none left", async () => {
    const payload = await buildGoalsPayload(
      { calories: 1800, protein: 120 },
      user.id,
    );
    expect(payload.rows.map((r) => r.key)).toEqual(["protein"]);
    await expect(
      buildGoalsPayload({ calories: 1800 }, user.id),
    ).rejects.toBeInstanceOf(WriteCardEditError);
  });
});

describe("performGoalsSave", () => {
  const payload: GoalsCardPayload = {
    rows: [
      { key: "calories", current: 1800, proposed: 2000 },
      { key: "carbs", current: null, proposed: 250 },
    ],
  };

  it("writes the proposed goals and records what each was before", async () => {
    const refs = await performGoalsSave(
      tx,
      cardFor(payload),
      {},
      {
        userId: user.id,
      },
    );
    expect(await goalsOf()).toEqual({
      calories: 2000,
      protein: 100,
      carbs: 250,
      fat: 60,
    });
    expect(refs.goalsRestore).toEqual([
      { key: "calories", before: 1800, after: 2000 },
      { key: "carbs", before: null, after: 250 },
    ]);
  });

  it("writes the user's edited values instead", async () => {
    await performGoalsSave(
      tx,
      cardFor(payload),
      { values: [2100, 250] },
      {
        userId: user.id,
      },
    );
    expect((await goalsOf()).calories).toBe(2100);
  });

  it.each([
    ["calories under the floor", { values: [1000, 250] }],
    ["a value past its bound", { values: [2000, 1001] }],
    ["the wrong number of values", { values: [2000] }],
    ["a field the card does not have", { values: [2000, 250], key: "fat" }],
  ])("refuses %s and writes nothing", async (_name, edits) => {
    await expect(
      performGoalsSave(tx, cardFor(payload), edits, { userId: user.id }),
    ).rejects.toBeInstanceOf(WriteCardEditError);
    expect((await goalsOf()).calories).toBe(1800);
  });

  it("refuses a save that changes nothing", async () => {
    await expect(
      performGoalsSave(
        tx,
        cardFor({ rows: [{ key: "calories", current: 1800, proposed: 2000 }] }),
        { values: [1800] },
        { userId: user.id },
      ),
    ).rejects.toBeInstanceOf(WriteCardEditError);
  });
});

describe("revertGoalsSave", () => {
  it("puts back each goal that still holds what the card saved", async () => {
    await setGoals({ dailyCalorieGoal: 2000, dailyCarbsGoal: 250 });
    await revertGoalsSave(
      tx,
      cardFor(
        { rows: [{ key: "calories", current: 1800, proposed: 2000 }] },
        {
          goalsRestore: [
            { key: "calories", before: 1800, after: 2000 },
            { key: "carbs", before: null, after: 250 },
          ],
        },
      ),
    );
    expect(await goalsOf()).toMatchObject({ calories: 1800, carbs: null });
  });

  it("leaves a goal the user has changed since", async () => {
    await setGoals({ dailyCalorieGoal: 2300 });
    await revertGoalsSave(
      tx,
      cardFor(
        { rows: [{ key: "calories", current: 1800, proposed: 2000 }] },
        { goalsRestore: [{ key: "calories", before: 1800, after: 2000 }] },
      ),
    );
    expect((await goalsOf()).calories).toBe(2300);
  });
});

describe("describeGoals", () => {
  it("names each goal with its value on the card and its current value", () => {
    expect(
      describeGoals(
        {
          rows: [
            { key: "calories", current: 1800, proposed: 2000 },
            { key: "carbs", current: null, proposed: 250 },
          ],
        },
        { values: [2100, 250] },
      ),
    ).toBe("calories 2100 (now 1800); carbs 250 g (now not set)");
  });
});
