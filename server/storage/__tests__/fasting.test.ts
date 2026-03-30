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

vi.mock("../../db", () => ({
  get db() {
    return getTestTx();
  },
}));

const {
  getFastingSchedule,
  upsertFastingSchedule,
  getActiveFastingLog,
  getFastingLogs,
  createFastingLog,
  endFastingLog,
} = await import("../fasting");

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

describe("fasting storage", () => {
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

  // ---- Fasting Schedule ----

  describe("getFastingSchedule", () => {
    it("returns undefined when no schedule exists", async () => {
      const result = await getFastingSchedule(testUser.id);
      expect(result).toBeUndefined();
    });

    it("returns the schedule when one exists", async () => {
      await upsertFastingSchedule(testUser.id, {
        protocol: "16:8",
        fastingHours: 16,
        eatingHours: 8,
        eatingWindowStart: "12:00",
        eatingWindowEnd: "20:00",
      });
      const result = await getFastingSchedule(testUser.id);
      expect(result).toBeDefined();
      expect(result!.fastingHours).toBe(16);
      expect(result!.protocol).toBe("16:8");
    });
  });

  describe("upsertFastingSchedule", () => {
    it("inserts a new schedule", async () => {
      const schedule = await upsertFastingSchedule(testUser.id, {
        protocol: "16:8",
        fastingHours: 16,
        eatingHours: 8,
        eatingWindowStart: "12:00",
        eatingWindowEnd: "20:00",
      });
      expect(schedule.userId).toBe(testUser.id);
      expect(schedule.fastingHours).toBe(16);
    });

    it("updates an existing schedule on conflict", async () => {
      await upsertFastingSchedule(testUser.id, {
        protocol: "16:8",
        fastingHours: 16,
        eatingHours: 8,
        eatingWindowStart: "12:00",
        eatingWindowEnd: "20:00",
      });
      const updated = await upsertFastingSchedule(testUser.id, {
        protocol: "18:6",
        fastingHours: 18,
        eatingHours: 6,
        eatingWindowStart: "14:00",
        eatingWindowEnd: "20:00",
      });
      expect(updated.fastingHours).toBe(18);
      expect(updated.protocol).toBe("18:6");
      expect(updated.eatingWindowStart).toBe("14:00");
    });
  });

  // ---- Fasting Logs ----

  describe("createFastingLog", () => {
    it("creates a fasting log", async () => {
      const log = await createFastingLog({
        userId: testUser.id,
        startedAt: new Date("2024-06-01T08:00:00Z"),
        targetDurationHours: 16,
      });
      expect(log.id).toBeDefined();
      expect(log.userId).toBe(testUser.id);
      expect(log.targetDurationHours).toBe(16);
    });
  });

  describe("getActiveFastingLog", () => {
    it("returns undefined when no active log", async () => {
      const result = await getActiveFastingLog(testUser.id);
      expect(result).toBeUndefined();
    });

    it("returns log with null endedAt", async () => {
      await createFastingLog({
        userId: testUser.id,
        startedAt: new Date(),
        targetDurationHours: 16,
      });
      const active = await getActiveFastingLog(testUser.id);
      expect(active).toBeDefined();
      expect(active!.endedAt).toBeNull();
    });

    it("does not return completed logs", async () => {
      const log = await createFastingLog({
        userId: testUser.id,
        startedAt: new Date("2024-06-01T08:00:00Z"),
        targetDurationHours: 16,
      });
      await endFastingLog(log.id, testUser.id, new Date(), 960, true);

      const active = await getActiveFastingLog(testUser.id);
      expect(active).toBeUndefined();
    });
  });

  describe("getFastingLogs", () => {
    it("returns logs ordered by startedAt desc", async () => {
      await createFastingLog({
        userId: testUser.id,
        startedAt: new Date("2024-01-01T08:00:00Z"),
        endedAt: new Date("2024-01-01T16:00:00Z"),
        targetDurationHours: 16,
      });
      await createFastingLog({
        userId: testUser.id,
        startedAt: new Date("2024-06-01T08:00:00Z"),
        endedAt: new Date("2024-06-02T02:00:00Z"),
        targetDurationHours: 18,
      });

      const logs = await getFastingLogs(testUser.id);
      expect(logs).toHaveLength(2);
      expect(logs[0].targetDurationHours).toBe(18); // June = more recent
    });

    it("respects limit parameter", async () => {
      for (let i = 0; i < 5; i++) {
        await createFastingLog({
          userId: testUser.id,
          startedAt: new Date(`2024-0${i + 1}-01T08:00:00Z`),
          endedAt: new Date(`2024-0${i + 1}-01T16:00:00Z`),
          targetDurationHours: 16,
        });
      }

      const logs = await getFastingLogs(testUser.id, 3);
      expect(logs).toHaveLength(3);
    });
  });

  describe("endFastingLog", () => {
    it("ends a fasting log successfully", async () => {
      const log = await createFastingLog({
        userId: testUser.id,
        startedAt: new Date("2024-06-01T08:00:00Z"),
        targetDurationHours: 16,
      });

      const endedAt = new Date("2024-06-02T00:00:00Z");
      const ended = await endFastingLog(
        log.id,
        testUser.id,
        endedAt,
        960,
        true,
        "Felt great",
      );
      expect(ended).toBeDefined();
      expect(ended!.endedAt).toEqual(endedAt);
      expect(ended!.actualDurationMinutes).toBe(960);
      expect(ended!.completed).toBe(true);
      expect(ended!.note).toBe("Felt great");
    });

    it("returns undefined for wrong user (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const log = await createFastingLog({
        userId: otherUser.id,
        startedAt: new Date(),
        targetDurationHours: 16,
      });

      const result = await endFastingLog(
        log.id,
        testUser.id,
        new Date(),
        0,
        false,
      );
      expect(result).toBeUndefined();
    });
  });
});
