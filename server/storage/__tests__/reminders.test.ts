import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  afterAll,
  vi,
} from "vitest";
import {
  setupTestTransaction,
  rollbackTestTransaction,
  closeTestPool,
  createTestUser,
  getTestTx,
} from "../../../test/db-test-utils";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@shared/schema";
import { pendingReminders } from "@shared/schema";
import { eq } from "drizzle-orm";

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  createPendingReminder,
  hasPendingReminderToday,
  hasPendingReminders,
  acknowledgeReminders,
  getTodaysPendingReminders,
} = await import("../reminders");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

describe("reminders storage", () => {
  beforeEach(async () => {
    tx = await setupTestTransaction();
    testUser = await createTestUser(tx);
  });

  afterEach(async () => {
    await rollbackTestTransaction();
  });

  afterAll(async () => {
    await closeTestPool();
  });

  describe("createPendingReminder", () => {
    it("inserts a reminder row", async () => {
      await createPendingReminder({
        userId: testUser.id,
        type: "meal-log",
        context: { lastLoggedAt: null },
        scheduledFor: new Date(),
      });

      const rows = await tx
        .select()
        .from(pendingReminders)
        .where(eq(pendingReminders.userId, testUser.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].type).toBe("meal-log");
    });

    it("is a no-op when a same-day unacked reminder of the same type exists (unique index)", async () => {
      await createPendingReminder({
        userId: testUser.id,
        type: "meal-log",
        context: { lastLoggedAt: null },
        scheduledFor: new Date(),
      });
      await createPendingReminder({
        userId: testUser.id,
        type: "meal-log",
        context: { lastLoggedAt: null },
        scheduledFor: new Date(),
      });
      const rows = await tx
        .select()
        .from(pendingReminders)
        .where(eq(pendingReminders.userId, testUser.id));
      expect(rows).toHaveLength(1);
    });
  });

  describe("hasPendingReminderToday", () => {
    it("returns false when no reminders exist", async () => {
      const result = await hasPendingReminderToday(testUser.id, "meal-log");
      expect(result).toBe(false);
    });

    it("returns true when an unacked reminder of the type is scheduled today", async () => {
      await createPendingReminder({
        userId: testUser.id,
        type: "meal-log",
        context: { lastLoggedAt: null },
        scheduledFor: new Date(),
      });
      const result = await hasPendingReminderToday(testUser.id, "meal-log");
      expect(result).toBe(true);
    });

    it("returns false for a different reminder type", async () => {
      await createPendingReminder({
        userId: testUser.id,
        type: "meal-log",
        context: { lastLoggedAt: null },
        scheduledFor: new Date(),
      });
      const result = await hasPendingReminderToday(testUser.id, "commitment");
      expect(result).toBe(false);
    });
  });

  describe("hasPendingReminders", () => {
    it("returns false when no reminders exist", async () => {
      const result = await hasPendingReminders(testUser.id);
      expect(result).toBe(false);
    });

    it("returns true when at least one unacked reminder exists", async () => {
      await createPendingReminder({
        userId: testUser.id,
        type: "meal-log",
        context: { lastLoggedAt: null },
        scheduledFor: new Date(),
      });
      const result = await hasPendingReminders(testUser.id);
      expect(result).toBe(true);
    });
  });

  describe("acknowledgeReminders", () => {
    it("returns empty array when no reminders exist", async () => {
      const result = await acknowledgeReminders(testUser.id);
      expect(result).toEqual([]);
    });

    it("acknowledges all unacked reminders and returns validated context items", async () => {
      await createPendingReminder({
        userId: testUser.id,
        type: "meal-log",
        context: { lastLoggedAt: null },
        scheduledFor: new Date(),
      });
      await createPendingReminder({
        userId: testUser.id,
        type: "daily-checkin",
        context: { calories: 1500 },
        scheduledFor: new Date(),
      });

      const items = await acknowledgeReminders(testUser.id);
      expect(items).toHaveLength(2);
      const types = items.map((i) => i.type).sort();
      expect(types).toEqual(["daily-checkin", "meal-log"]);

      // After acknowledgement, hasPendingReminders should be false.
      const stillPending = await hasPendingReminders(testUser.id);
      expect(stillPending).toBe(false);
    });

    it("filters malformed-context rows out of the returned list but still acknowledges them", async () => {
      // Insert a row with valid type but context shape that doesn't match the
      // discriminated union (missing `lastLoggedAt` for meal-log).
      const [row] = await tx
        .insert(pendingReminders)
        .values({
          userId: testUser.id,
          type: "meal-log",
          context: { somethingElse: "garbage" },
          scheduledFor: new Date(),
        })
        .returning();

      const items = await acknowledgeReminders(testUser.id);
      // The malformed row is dropped from the returned list.
      expect(items).toHaveLength(0);

      // But the storage function uses a single UPDATE ... RETURNING that
      // acknowledges every pending row first, then filters bad context in JS,
      // so the row's acknowledgedAt is set. Verify that — otherwise the
      // function would re-acknowledge it on every call.
      const [stored] = await tx
        .select()
        .from(pendingReminders)
        .where(eq(pendingReminders.id, row.id));
      expect(stored.acknowledgedAt).not.toBeNull();
    });
  });
  describe("getTodaysPendingReminders", () => {
    const insert = (values: {
      type: "meal-log" | "commitment" | "daily-checkin";
      context: Record<string, unknown>;
      scheduledFor: Date;
      userId?: string;
      acknowledgedAt?: Date;
    }) =>
      tx
        .insert(pendingReminders)
        .values({ userId: testUser.id, ...values })
        .returning();

    it("returns today's unacknowledged reminders without acknowledging them", async () => {
      const now = new Date("2026-11-08T15:00:00Z");
      const [row] = await insert({
        type: "meal-log",
        context: { lastLoggedAt: null },
        scheduledFor: new Date("2026-11-08T12:00:00Z"),
      });

      const items = await getTodaysPendingReminders(testUser.id, "UTC", now);
      expect(items).toEqual([{ type: "meal-log", lastLoggedAt: null }]);

      const [stored] = await tx
        .select()
        .from(pendingReminders)
        .where(eq(pendingReminders.id, row.id));
      expect(stored.acknowledgedAt).toBeNull();
    });

    it("leaves out yesterday's and acknowledged reminders", async () => {
      const now = new Date("2026-11-08T15:00:00Z");
      await insert({
        type: "meal-log",
        context: { lastLoggedAt: null },
        scheduledFor: new Date("2026-11-07T12:00:00Z"),
      });
      await insert({
        type: "daily-checkin",
        context: { calories: 0 },
        scheduledFor: new Date("2026-11-08T09:00:00Z"),
        acknowledgedAt: new Date("2026-11-08T10:00:00Z"),
      });

      expect(await getTodaysPendingReminders(testUser.id, "UTC", now)).toEqual(
        [],
      );
    });

    it("uses the user's local date, not UTC's", async () => {
      // 23:30 in Los Angeles on Nov 8 is 07:30 UTC on Nov 9.
      const now = new Date("2026-11-09T07:30:00Z");
      // 22:00 LA on Nov 8 (06:00 UTC Nov 9) is today for the user...
      await insert({
        type: "meal-log",
        context: { lastLoggedAt: null },
        scheduledFor: new Date("2026-11-09T06:00:00Z"),
      });
      // ...and 09:00 LA on Nov 7 is not.
      await insert({
        type: "daily-checkin",
        context: { calories: 0 },
        scheduledFor: new Date("2026-11-07T17:00:00Z"),
      });

      const items = await getTodaysPendingReminders(
        testUser.id,
        "America/Los_Angeles",
        now,
      );
      expect(items.map((i) => i.type)).toEqual(["meal-log"]);
    });

    it("returns the newest first and skips malformed context", async () => {
      const now = new Date("2026-11-08T20:00:00Z");
      await insert({
        type: "daily-checkin",
        context: { calories: 0 },
        scheduledFor: new Date("2026-11-08T09:00:00Z"),
      });
      await insert({
        type: "commitment",
        context: { notebookEntryId: 4, content: "walk after lunch" },
        scheduledFor: new Date("2026-11-08T14:00:00Z"),
      });
      await insert({
        type: "meal-log",
        context: { somethingElse: "garbage" },
        scheduledFor: new Date("2026-11-08T18:00:00Z"),
      });

      const items = await getTodaysPendingReminders(testUser.id, "UTC", now);
      expect(items.map((i) => i.type)).toEqual(["commitment", "daily-checkin"]);
    });

    it("never returns another user's reminders", async () => {
      const other = await createTestUser(tx);
      const now = new Date("2026-11-08T15:00:00Z");
      await insert({
        userId: other.id,
        type: "meal-log",
        context: { lastLoggedAt: null },
        scheduledFor: new Date("2026-11-08T12:00:00Z"),
      });

      expect(await getTodaysPendingReminders(testUser.id, "UTC", now)).toEqual(
        [],
      );
    });
  });
});
