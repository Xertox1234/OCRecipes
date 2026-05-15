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
});
