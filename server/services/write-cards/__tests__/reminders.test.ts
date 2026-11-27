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
  createTestUserProfile,
  getTestTx,
} from "../../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import type { RemindersCardPayload } from "@shared/schemas/coach-write-cards";
import type { ReminderMutes } from "@shared/types/reminders";
import { createMockCoachWriteCard } from "../../../__tests__/factories";

vi.mock("../../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  buildRemindersPayload,
  performRemindersSave,
  revertRemindersSave,
  describeReminders,
  setRemindersCardArgsSchema,
} = await import("../reminders");
const { WriteCardEditError } = await import("../errors");

let tx: NodePgDatabase<typeof schema>;
let user: schema.User;

const setMutes = (reminderMutes: ReminderMutes) =>
  tx
    .update(schema.userProfiles)
    .set({ reminderMutes })
    .where(eq(schema.userProfiles.userId, user.id));
const mutesOf = async () => {
  const [row] = await tx
    .select({ reminderMutes: schema.userProfiles.reminderMutes })
    .from(schema.userProfiles)
    .where(eq(schema.userProfiles.userId, user.id));
  return row?.reminderMutes;
};
const cardFor = (payload: RemindersCardPayload, savedRefs = {}) =>
  createMockCoachWriteCard({
    userId: user.id,
    kind: "reminders",
    payload,
    savedRefs,
  });

beforeEach(async () => {
  tx = await setupTestTransaction();
  user = await createTestUser(tx);
  await createTestUserProfile(tx, user.id, {
    reminderMutes: { "meal-log": true },
  });
});
afterEach(async () => {
  await rollbackTestTransaction();
});
afterAll(async () => {
  await closeTestPool();
});

describe("setRemindersCardArgsSchema", () => {
  it("needs at least one reminder, each on or off", () => {
    expect(setRemindersCardArgsSchema.safeParse({}).success).toBe(false);
    expect(
      setRemindersCardArgsSchema.safeParse({ mealLog: "off" }).success,
    ).toBe(false);
    expect(
      setRemindersCardArgsSchema.safeParse({ dailyCheckin: false }).success,
    ).toBe(true);
  });
});

describe("buildRemindersPayload", () => {
  it("makes one row per reminder that would change", async () => {
    // Meal-log is muted (off); the rest are on.
    expect(
      await buildRemindersPayload(
        { mealLog: true, dailyCheckin: false, commitment: true },
        user.id,
      ),
    ).toEqual({
      changes: [
        { key: "meal-log", on: true },
        { key: "daily-checkin", on: false },
      ],
    });
  });

  it("refuses a card with nothing to change", async () => {
    await expect(
      buildRemindersPayload({ mealLog: false, expiringFood: true }, user.id),
    ).rejects.toBeInstanceOf(WriteCardEditError);
  });

  it("saves for a user with no profile row yet, making the row", async () => {
    const other = await createTestUser(tx, { username: "first_save_user" });
    const refs = await performRemindersSave(
      tx,
      cardFor({ changes: [{ key: "commitment", on: false }] }),
      {},
      { userId: other.id },
    );
    expect(refs.remindersRestore).toEqual([
      { key: "commitment", before: false, after: true },
    ]);
    const [row] = await tx
      .select({ reminderMutes: schema.userProfiles.reminderMutes })
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, other.id));
    expect(row.reminderMutes).toEqual({ commitment: true });
  });

  it("reads a user with no profile row as every reminder on", async () => {
    const other = await createTestUser(tx, { username: "no_profile_user" });
    expect(
      await buildRemindersPayload({ commitment: false }, other.id),
    ).toEqual({ changes: [{ key: "commitment", on: false }] });
  });
});

describe("performRemindersSave", () => {
  const payload: RemindersCardPayload = {
    changes: [
      { key: "meal-log", on: true },
      { key: "daily-checkin", on: false },
    ],
  };

  it("switches each reminder and records what it was before", async () => {
    const refs = await performRemindersSave(
      tx,
      cardFor(payload),
      {},
      {
        userId: user.id,
      },
    );
    expect(await mutesOf()).toEqual({
      "meal-log": false,
      "daily-checkin": true,
    });
    expect(refs.remindersRestore).toEqual([
      { key: "meal-log", before: true, after: false },
      { key: "daily-checkin", before: false, after: true },
    ]);
  });

  it("writes the user's switches instead", async () => {
    const refs = await performRemindersSave(
      tx,
      cardFor(payload),
      { on: [true, true] },
      { userId: user.id },
    );
    // Daily check-in stays on, so only meal-log changes.
    expect(refs.remindersRestore).toEqual([
      { key: "meal-log", before: true, after: false },
    ]);
    expect(await mutesOf()).toEqual({ "meal-log": false });
  });

  it.each([
    ["the wrong number of switches", { on: [true] }],
    ["a field the card does not have", { on: [true, false], key: "x" }],
  ])("refuses %s and writes nothing", async (_name, edits) => {
    await expect(
      performRemindersSave(tx, cardFor(payload), edits, { userId: user.id }),
    ).rejects.toBeInstanceOf(WriteCardEditError);
    expect(await mutesOf()).toEqual({ "meal-log": true });
  });

  it("refuses a save that changes nothing", async () => {
    await expect(
      performRemindersSave(
        tx,
        cardFor(payload),
        { on: [false, true] },
        { userId: user.id },
      ),
    ).rejects.toBeInstanceOf(WriteCardEditError);
  });
});

describe("revertRemindersSave", () => {
  it("puts back each reminder that still holds what the card saved", async () => {
    await setMutes({ "meal-log": false, "daily-checkin": true });
    await revertRemindersSave(
      tx,
      cardFor(
        { changes: [{ key: "meal-log", on: true }] },
        {
          remindersRestore: [
            { key: "meal-log", before: true, after: false },
            { key: "daily-checkin", before: false, after: true },
          ],
        },
      ),
    );
    expect(await mutesOf()).toEqual({
      "meal-log": true,
      "daily-checkin": false,
    });
  });

  it("leaves a reminder the user has switched since", async () => {
    await setMutes({ "meal-log": true });
    await revertRemindersSave(
      tx,
      cardFor(
        { changes: [{ key: "meal-log", on: true }] },
        { remindersRestore: [{ key: "meal-log", before: true, after: false }] },
      ),
    );
    expect(await mutesOf()).toEqual({ "meal-log": true });
  });
});

describe("describeReminders", () => {
  it("names each reminder with its switch on the card and as it is now", () => {
    expect(
      describeReminders(
        {
          changes: [
            { key: "meal-log", on: true },
            { key: "pantry-expiring", on: false },
          ],
        },
        { on: [false] },
      ),
    ).toBe(
      "Meal logging nudges: set to off on the card (off in the app until it is saved); Expiring food: set to off on the card (on in the app until it is saved)",
    );
  });
});
