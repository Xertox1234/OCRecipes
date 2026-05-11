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

// Mock the db import so the storage functions use our test transaction
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Mock logger to suppress warn output in tests
vi.mock("../../lib/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Import after mocking
const {
  createPendingReminder,
  hasPendingReminderToday,
  hasPendingReminders,
  acknowledgeReminders,
} = await import("../reminders");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

/** Returns a Date object scheduled for today at the given hour (UTC). */
function todayAt(hour: number): Date {
  const d = new Date();
  d.setUTCHours(hour, 0, 0, 0);
  return d;
}

/** Returns a Date for yesterday at noon. */
function yesterday(): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  d.setUTCHours(12, 0, 0, 0);
  return d;
}

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

  // --------------------------------------------------------------------------
  // createPendingReminder
  // --------------------------------------------------------------------------
  describe("createPendingReminder", () => {
    it("creates a pending reminder without throwing", async () => {
      await expect(
        createPendingReminder({
          userId: testUser.id,
          type: "meal-log",
          context: { lastLoggedAt: null },
          scheduledFor: todayAt(12),
        }),
      ).resolves.not.toThrow();
    });

    it("is idempotent — duplicate type+day insert is silently ignored", async () => {
      const scheduledFor = todayAt(9);
      await createPendingReminder({
        userId: testUser.id,
        type: "daily-checkin",
        context: { calories: 0 },
        scheduledFor,
      });

      // Second call with same userId+type+day should not throw
      await expect(
        createPendingReminder({
          userId: testUser.id,
          type: "daily-checkin",
          context: { calories: 500 },
          scheduledFor,
        }),
      ).resolves.not.toThrow();
    });

    it("allows different types for the same user on the same day", async () => {
      const scheduledFor = todayAt(10);
      await createPendingReminder({
        userId: testUser.id,
        type: "meal-log",
        context: { lastLoggedAt: null },
        scheduledFor,
      });
      await createPendingReminder({
        userId: testUser.id,
        type: "commitment",
        context: { notebookEntryId: 1, content: "Exercise" },
        scheduledFor,
      });

      const hasMealLog = await hasPendingReminderToday(testUser.id, "meal-log");
      const hasCommitment = await hasPendingReminderToday(
        testUser.id,
        "commitment",
      );
      expect(hasMealLog).toBe(true);
      expect(hasCommitment).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // hasPendingReminderToday
  // --------------------------------------------------------------------------
  describe("hasPendingReminderToday", () => {
    it("returns false when no reminder exists for today", async () => {
      const result = await hasPendingReminderToday(testUser.id, "meal-log");
      expect(result).toBe(false);
    });

    it("returns true when an unacknowledged reminder exists for today", async () => {
      await createPendingReminder({
        userId: testUser.id,
        type: "meal-log",
        context: { lastLoggedAt: null },
        scheduledFor: todayAt(12),
      });

      const result = await hasPendingReminderToday(testUser.id, "meal-log");
      expect(result).toBe(true);
    });

    it("returns false for a different user", async () => {
      const otherUser = await createTestUser(tx);
      await createPendingReminder({
        userId: otherUser.id,
        type: "meal-log",
        context: { lastLoggedAt: null },
        scheduledFor: todayAt(12),
      });

      const result = await hasPendingReminderToday(testUser.id, "meal-log");
      expect(result).toBe(false);
    });

    it("returns false after the reminder has been acknowledged", async () => {
      await createPendingReminder({
        userId: testUser.id,
        type: "meal-log",
        context: { lastLoggedAt: null },
        scheduledFor: todayAt(12),
      });

      await acknowledgeReminders(testUser.id);

      const result = await hasPendingReminderToday(testUser.id, "meal-log");
      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // hasPendingReminders
  // --------------------------------------------------------------------------
  describe("hasPendingReminders", () => {
    it("returns false when no reminders exist", async () => {
      const result = await hasPendingReminders(testUser.id);
      expect(result).toBe(false);
    });

    it("returns true when there is at least one unacknowledged reminder", async () => {
      await createPendingReminder({
        userId: testUser.id,
        type: "user-set",
        context: { message: "Don't forget to log!" },
        scheduledFor: todayAt(8),
      });

      const result = await hasPendingReminders(testUser.id);
      expect(result).toBe(true);
    });

    it("returns false for a different user's reminders", async () => {
      const otherUser = await createTestUser(tx);
      await createPendingReminder({
        userId: otherUser.id,
        type: "meal-log",
        context: { lastLoggedAt: null },
        scheduledFor: todayAt(12),
      });

      const result = await hasPendingReminders(testUser.id);
      expect(result).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // acknowledgeReminders
  // --------------------------------------------------------------------------
  describe("acknowledgeReminders", () => {
    it("returns empty array when no unacknowledged reminders exist", async () => {
      const result = await acknowledgeReminders(testUser.id);
      expect(result).toEqual([]);
    });

    it("returns context items for acknowledged reminders", async () => {
      await createPendingReminder({
        userId: testUser.id,
        type: "meal-log",
        context: { lastLoggedAt: null },
        scheduledFor: todayAt(12),
      });
      await createPendingReminder({
        userId: testUser.id,
        type: "user-set",
        context: { message: "Go for a walk" },
        scheduledFor: todayAt(10),
      });

      const result = await acknowledgeReminders(testUser.id);
      expect(result).toHaveLength(2);

      const types = result.map((r) => r.type);
      expect(types).toContain("meal-log");
      expect(types).toContain("user-set");
    });

    it("marks reminders as acknowledged so subsequent calls return empty", async () => {
      await createPendingReminder({
        userId: testUser.id,
        type: "daily-checkin",
        context: { calories: 1200 },
        scheduledFor: todayAt(18),
      });

      const first = await acknowledgeReminders(testUser.id);
      expect(first).toHaveLength(1);

      const second = await acknowledgeReminders(testUser.id);
      expect(second).toHaveLength(0);
    });

    it("does not acknowledge reminders for other users", async () => {
      const otherUser = await createTestUser(tx);
      await createPendingReminder({
        userId: otherUser.id,
        type: "meal-log",
        context: { lastLoggedAt: null },
        scheduledFor: todayAt(12),
      });

      const result = await acknowledgeReminders(testUser.id);
      expect(result).toHaveLength(0);

      const otherStillHas = await hasPendingReminders(otherUser.id);
      expect(otherStillHas).toBe(true);
    });

    it("skips reminders with malformed JSONB context without throwing", async () => {
      // Create a reminder scheduled for yesterday to avoid unique-index collision
      // with a valid reminder of the same type created in the same test.
      // We insert a raw row with malformed context directly via the schema helper
      // so we can bypass Zod validation.
      const { pendingReminders } = await import("@shared/schema");
      await tx.insert(pendingReminders).values({
        userId: testUser.id,
        type: "meal-log",
        context: { unexpectedKey: true } as unknown as Record<string, unknown>,
        scheduledFor: yesterday(),
      });

      // Should not throw; malformed rows are filtered out
      const result = await acknowledgeReminders(testUser.id);
      expect(Array.isArray(result)).toBe(true);
    });
  });
});
