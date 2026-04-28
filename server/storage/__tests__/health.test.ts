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
import { weightLogs } from "@shared/schema";

// Mock the db import so the storage functions use our test transaction
vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

// Import after mocking
const {
  getWeightLogs,
  getLatestWeight,
  deleteWeightLog,
  getHealthKitSyncSettings,
  upsertHealthKitSyncSetting,
  updateHealthKitLastSync,
} = await import("../health");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

describe("health storage", () => {
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

  // ==========================================================================
  // WEIGHT LOGS
  // ==========================================================================

  describe("getWeightLogs", () => {
    it("returns empty array when no logs exist", async () => {
      const logs = await getWeightLogs(testUser.id);
      expect(logs).toEqual([]);
    });

    it("does not return logs from other users", async () => {
      const otherUser = await createTestUser(tx);
      // Insert a weight log directly for otherUser via tx
      await tx
        .insert(weightLogs)
        .values({ userId: otherUser.id, weight: "75.0" });

      const logs = await getWeightLogs(testUser.id);
      expect(logs).toHaveLength(0);
    });

    it("filters by from/to date range", async () => {
      const jan = new Date("2025-01-15T10:00:00Z");
      const mar = new Date("2025-03-15T10:00:00Z");

      await tx
        .insert(weightLogs)
        .values({ userId: testUser.id, weight: "70.0", loggedAt: jan });
      await tx
        .insert(weightLogs)
        .values({ userId: testUser.id, weight: "71.0", loggedAt: mar });

      const filtered = await getWeightLogs(testUser.id, {
        from: new Date("2025-02-01T00:00:00Z"),
        to: new Date("2025-04-01T00:00:00Z"),
      });
      expect(filtered).toHaveLength(1);
      expect(Number(filtered[0].weight)).toBeCloseTo(71, 1);
    });

    it("respects limit parameter", async () => {
      const dates = [
        new Date("2025-01-01T10:00:00Z"),
        new Date("2025-01-02T10:00:00Z"),
        new Date("2025-01-03T10:00:00Z"),
      ];
      for (const [i, d] of dates.entries()) {
        await tx
          .insert(weightLogs)
          .values({ userId: testUser.id, weight: `7${i}.0`, loggedAt: d });
      }

      const limited = await getWeightLogs(testUser.id, { limit: 2 });
      expect(limited).toHaveLength(2);
    });

    it("returns logs ordered by loggedAt descending", async () => {
      await tx.insert(weightLogs).values([
        {
          userId: testUser.id,
          weight: "70.0",
          loggedAt: new Date("2025-01-01T10:00:00Z"),
        },
        {
          userId: testUser.id,
          weight: "71.0",
          loggedAt: new Date("2025-01-03T10:00:00Z"),
        },
        {
          userId: testUser.id,
          weight: "72.0",
          loggedAt: new Date("2025-01-02T10:00:00Z"),
        },
      ]);

      const logs = await getWeightLogs(testUser.id);
      expect(Number(logs[0].weight)).toBeCloseTo(71, 1);
      expect(Number(logs[1].weight)).toBeCloseTo(72, 1);
      expect(Number(logs[2].weight)).toBeCloseTo(70, 1);
    });
  });

  describe("getLatestWeight", () => {
    it("returns undefined when no logs exist", async () => {
      const latest = await getLatestWeight(testUser.id);
      expect(latest).toBeUndefined();
    });

    it("returns the most recent weight log", async () => {
      await tx.insert(weightLogs).values([
        {
          userId: testUser.id,
          weight: "70.0",
          loggedAt: new Date("2025-01-01T10:00:00Z"),
        },
        {
          userId: testUser.id,
          weight: "73.0",
          loggedAt: new Date("2025-01-05T10:00:00Z"),
        },
      ]);

      const latest = await getLatestWeight(testUser.id);
      expect(latest).toBeDefined();
      expect(Number(latest!.weight)).toBeCloseTo(73, 1);
    });

    it("does not return logs from other users", async () => {
      const otherUser = await createTestUser(tx);
      await tx
        .insert(weightLogs)
        .values({ userId: otherUser.id, weight: "80.0" });

      const latest = await getLatestWeight(testUser.id);
      expect(latest).toBeUndefined();
    });
  });

  describe("deleteWeightLog", () => {
    it("deletes a log owned by the user and returns true", async () => {
      const [log] = await tx
        .insert(weightLogs)
        .values({ userId: testUser.id, weight: "70.0" })
        .returning();

      const deleted = await deleteWeightLog(log.id, testUser.id);
      expect(deleted).toBe(true);

      const remaining = await getWeightLogs(testUser.id);
      expect(remaining).toHaveLength(0);
    });

    it("returns false when another user tries to delete (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const [log] = await tx
        .insert(weightLogs)
        .values({ userId: testUser.id, weight: "70.0" })
        .returning();

      const deleted = await deleteWeightLog(log.id, otherUser.id);
      expect(deleted).toBe(false);

      const remaining = await getWeightLogs(testUser.id);
      expect(remaining).toHaveLength(1);
    });

    it("returns false for a non-existent log", async () => {
      const deleted = await deleteWeightLog(999999, testUser.id);
      expect(deleted).toBe(false);
    });
  });

  // ==========================================================================
  // HEALTHKIT SYNC
  // ==========================================================================

  describe("getHealthKitSyncSettings", () => {
    it("returns empty array when no settings exist", async () => {
      const settings = await getHealthKitSyncSettings(testUser.id);
      expect(settings).toEqual([]);
    });

    it("returns settings for the user", async () => {
      await upsertHealthKitSyncSetting(testUser.id, "weight", true);
      await upsertHealthKitSyncSetting(testUser.id, "steps", false);

      const settings = await getHealthKitSyncSettings(testUser.id);
      expect(settings).toHaveLength(2);
    });

    it("does not return settings from other users", async () => {
      const otherUser = await createTestUser(tx);
      await upsertHealthKitSyncSetting(otherUser.id, "weight", true);

      const settings = await getHealthKitSyncSettings(testUser.id);
      expect(settings).toHaveLength(0);
    });
  });

  describe("upsertHealthKitSyncSetting", () => {
    it("creates a new sync setting and returns it", async () => {
      const setting = await upsertHealthKitSyncSetting(
        testUser.id,
        "weight",
        true,
        "read",
      );

      expect(setting.userId).toBe(testUser.id);
      expect(setting.dataType).toBe("weight");
      expect(setting.enabled).toBe(true);
      expect(setting.syncDirection).toBe("read");
    });

    it("updates an existing setting on conflict", async () => {
      await upsertHealthKitSyncSetting(testUser.id, "weight", true, "read");
      const updated = await upsertHealthKitSyncSetting(
        testUser.id,
        "weight",
        false,
        "write",
      );

      expect(updated.enabled).toBe(false);
      expect(updated.syncDirection).toBe("write");

      // Only one row should exist
      const settings = await getHealthKitSyncSettings(testUser.id);
      expect(settings.filter((s) => s.dataType === "weight")).toHaveLength(1);
    });

    it("defaults syncDirection to read when not provided", async () => {
      const setting = await upsertHealthKitSyncSetting(
        testUser.id,
        "steps",
        true,
      );
      expect(setting.syncDirection).toBe("read");
    });
  });

  describe("updateHealthKitLastSync", () => {
    it("updates lastSyncAt for the given user and dataType", async () => {
      await upsertHealthKitSyncSetting(testUser.id, "weight", true);

      const before = await getHealthKitSyncSettings(testUser.id);
      const beforeSync = before.find((s) => s.dataType === "weight");
      expect(beforeSync?.lastSyncAt).toBeNull();

      await updateHealthKitLastSync(testUser.id, "weight");

      const after = await getHealthKitSyncSettings(testUser.id);
      const afterSync = after.find((s) => s.dataType === "weight");
      expect(afterSync?.lastSyncAt).toBeInstanceOf(Date);
    });

    it("does not affect other dataTypes", async () => {
      await upsertHealthKitSyncSetting(testUser.id, "weight", true);
      await upsertHealthKitSyncSetting(testUser.id, "steps", true);

      await updateHealthKitLastSync(testUser.id, "weight");

      const settings = await getHealthKitSyncSettings(testUser.id);
      const steps = settings.find((s) => s.dataType === "steps");
      expect(steps?.lastSyncAt).toBeNull();
    });
  });
});
