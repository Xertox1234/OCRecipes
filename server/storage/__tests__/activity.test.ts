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
  getWeightLogs,
  createWeightLog: _createWeightLog,
  deleteWeightLog,
  getLatestWeight,
  getExerciseLogs,
  createExerciseLog: _createExerciseLog,
  updateExerciseLog,
  deleteExerciseLog,
  getExerciseDailySummary,
  searchExerciseLibrary,
  createExerciseLibraryEntry,
  getHealthKitSyncSettings,
  upsertHealthKitSyncSetting,
  updateHealthKitLastSync,
} = await import("../activity");

// Widen the insert types to allow passing `loggedAt` for ordering tests.
// The DB column has a default, but tests need deterministic timestamps.
const createWeightLog = _createWeightLog as (
  log: Parameters<typeof _createWeightLog>[0] & { loggedAt?: Date },
) => ReturnType<typeof _createWeightLog>;
const createExerciseLog = _createExerciseLog as (
  log: Parameters<typeof _createExerciseLog>[0] & { loggedAt?: Date },
) => ReturnType<typeof _createExerciseLog>;

let tx: NodePgDatabase<typeof schema>;
let testUser: schema.User;

describe("activity storage", () => {
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

  describe("createWeightLog", () => {
    it("creates a weight log with required fields", async () => {
      const log = await createWeightLog({
        userId: testUser.id,
        weight: "75.50",
      });
      expect(log.id).toBeDefined();
      expect(log.userId).toBe(testUser.id);
      expect(log.weight).toBe("75.50");
      expect(log.source).toBe("manual");
      expect(log.loggedAt).toBeInstanceOf(Date);
    });

    it("creates a weight log with optional fields", async () => {
      const log = await createWeightLog({
        userId: testUser.id,
        weight: "80.00",
        note: "After morning run",
        source: "healthkit",
      });
      expect(log.note).toBe("After morning run");
      expect(log.source).toBe("healthkit");
    });
  });

  describe("getWeightLogs", () => {
    it("returns empty array when no logs exist", async () => {
      const logs = await getWeightLogs(testUser.id);
      expect(logs).toEqual([]);
    });

    it("returns logs ordered by loggedAt descending", async () => {
      await createWeightLog({
        userId: testUser.id,
        weight: "70.00",
        loggedAt: new Date("2024-01-01T08:00:00Z"),
      });
      await createWeightLog({
        userId: testUser.id,
        weight: "72.00",
        loggedAt: new Date("2024-06-01T08:00:00Z"),
      });

      const logs = await getWeightLogs(testUser.id);
      expect(logs).toHaveLength(2);
      expect(logs[0].weight).toBe("72.00"); // June = more recent
      expect(logs[1].weight).toBe("70.00");
    });

    it("filters by date range (from)", async () => {
      await createWeightLog({
        userId: testUser.id,
        weight: "70.00",
        loggedAt: new Date("2024-01-01T08:00:00Z"),
      });
      await createWeightLog({
        userId: testUser.id,
        weight: "72.00",
        loggedAt: new Date("2024-06-01T08:00:00Z"),
      });

      const logs = await getWeightLogs(testUser.id, {
        from: new Date("2024-03-01T00:00:00Z"),
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].weight).toBe("72.00");
    });

    it("filters by date range (from + to)", async () => {
      await createWeightLog({
        userId: testUser.id,
        weight: "70.00",
        loggedAt: new Date("2024-01-15T08:00:00Z"),
      });
      await createWeightLog({
        userId: testUser.id,
        weight: "71.00",
        loggedAt: new Date("2024-03-15T08:00:00Z"),
      });
      await createWeightLog({
        userId: testUser.id,
        weight: "72.00",
        loggedAt: new Date("2024-06-15T08:00:00Z"),
      });

      const logs = await getWeightLogs(testUser.id, {
        from: new Date("2024-02-01T00:00:00Z"),
        to: new Date("2024-05-01T00:00:00Z"),
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].weight).toBe("71.00");
    });

    it("respects limit option", async () => {
      for (let i = 0; i < 5; i++) {
        await createWeightLog({
          userId: testUser.id,
          weight: `${70 + i}.00`,
          loggedAt: new Date(`2024-0${i + 1}-01T08:00:00Z`),
        });
      }

      const logs = await getWeightLogs(testUser.id, { limit: 2 });
      expect(logs).toHaveLength(2);
    });

    it("does not return another user's logs", async () => {
      const otherUser = await createTestUser(tx);
      await createWeightLog({ userId: otherUser.id, weight: "80.00" });

      const logs = await getWeightLogs(testUser.id);
      expect(logs).toHaveLength(0);
    });
  });

  describe("deleteWeightLog", () => {
    it("deletes a weight log belonging to the user", async () => {
      const log = await createWeightLog({
        userId: testUser.id,
        weight: "75.00",
      });
      const deleted = await deleteWeightLog(log.id, testUser.id);
      expect(deleted).toBe(true);

      const logs = await getWeightLogs(testUser.id);
      expect(logs).toHaveLength(0);
    });

    it("returns false for non-existent log", async () => {
      const deleted = await deleteWeightLog(999999, testUser.id);
      expect(deleted).toBe(false);
    });

    it("returns false when deleting another user's log (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const log = await createWeightLog({
        userId: otherUser.id,
        weight: "80.00",
      });

      const deleted = await deleteWeightLog(log.id, testUser.id);
      expect(deleted).toBe(false);
    });
  });

  describe("getLatestWeight", () => {
    it("returns undefined when no logs exist", async () => {
      const latest = await getLatestWeight(testUser.id);
      expect(latest).toBeUndefined();
    });

    it("returns the most recent weight log", async () => {
      await createWeightLog({
        userId: testUser.id,
        weight: "70.00",
        loggedAt: new Date("2024-01-01T08:00:00Z"),
      });
      await createWeightLog({
        userId: testUser.id,
        weight: "72.50",
        loggedAt: new Date("2024-06-01T08:00:00Z"),
      });

      const latest = await getLatestWeight(testUser.id);
      expect(latest).toBeDefined();
      expect(latest!.weight).toBe("72.50");
    });
  });

  // ==========================================================================
  // EXERCISE LOGS
  // ==========================================================================

  describe("createExerciseLog", () => {
    it("creates an exercise log with required fields", async () => {
      const log = await createExerciseLog({
        userId: testUser.id,
        exerciseName: "Running",
        exerciseType: "cardio",
        durationMinutes: 30,
      });
      expect(log.id).toBeDefined();
      expect(log.userId).toBe(testUser.id);
      expect(log.exerciseName).toBe("Running");
      expect(log.exerciseType).toBe("cardio");
      expect(log.durationMinutes).toBe(30);
      expect(log.loggedAt).toBeInstanceOf(Date);
    });

    it("creates an exercise log with optional fields", async () => {
      const log = await createExerciseLog({
        userId: testUser.id,
        exerciseName: "Bench Press",
        exerciseType: "strength",
        durationMinutes: 45,
        caloriesBurned: "350.00",
        intensity: "high",
        notes: "Felt strong today",
        source: "healthkit",
      });
      expect(log.caloriesBurned).toBe("350.00");
      expect(log.intensity).toBe("high");
      expect(log.notes).toBe("Felt strong today");
      expect(log.source).toBe("healthkit");
    });
  });

  describe("getExerciseLogs", () => {
    it("returns empty array when no logs exist", async () => {
      const logs = await getExerciseLogs(testUser.id);
      expect(logs).toEqual([]);
    });

    it("returns logs ordered by loggedAt descending", async () => {
      await createExerciseLog({
        userId: testUser.id,
        exerciseName: "Running",
        exerciseType: "cardio",
        durationMinutes: 30,
        loggedAt: new Date("2024-01-01T08:00:00Z"),
      });
      await createExerciseLog({
        userId: testUser.id,
        exerciseName: "Swimming",
        exerciseType: "cardio",
        durationMinutes: 45,
        loggedAt: new Date("2024-06-01T08:00:00Z"),
      });

      const logs = await getExerciseLogs(testUser.id);
      expect(logs).toHaveLength(2);
      expect(logs[0].exerciseName).toBe("Swimming"); // June = more recent
    });

    it("filters by date range", async () => {
      await createExerciseLog({
        userId: testUser.id,
        exerciseName: "Running",
        exerciseType: "cardio",
        durationMinutes: 30,
        loggedAt: new Date("2024-01-01T08:00:00Z"),
      });
      await createExerciseLog({
        userId: testUser.id,
        exerciseName: "Swimming",
        exerciseType: "cardio",
        durationMinutes: 45,
        loggedAt: new Date("2024-06-01T08:00:00Z"),
      });

      const logs = await getExerciseLogs(testUser.id, {
        from: new Date("2024-04-01T00:00:00Z"),
        to: new Date("2024-12-31T23:59:59Z"),
      });
      expect(logs).toHaveLength(1);
      expect(logs[0].exerciseName).toBe("Swimming");
    });

    it("respects limit option", async () => {
      for (let i = 0; i < 5; i++) {
        await createExerciseLog({
          userId: testUser.id,
          exerciseName: `Exercise ${i}`,
          exerciseType: "cardio",
          durationMinutes: 30,
          loggedAt: new Date(`2024-0${i + 1}-01T08:00:00Z`),
        });
      }

      const logs = await getExerciseLogs(testUser.id, { limit: 3 });
      expect(logs).toHaveLength(3);
    });
  });

  describe("updateExerciseLog", () => {
    it("updates exercise log fields", async () => {
      const log = await createExerciseLog({
        userId: testUser.id,
        exerciseName: "Running",
        exerciseType: "cardio",
        durationMinutes: 30,
      });

      const updated = await updateExerciseLog(log.id, testUser.id, {
        durationMinutes: 45,
        caloriesBurned: "500.00",
        notes: "Extended session",
      });

      expect(updated).toBeDefined();
      expect(updated!.durationMinutes).toBe(45);
      expect(updated!.caloriesBurned).toBe("500.00");
      expect(updated!.notes).toBe("Extended session");
      // Unchanged fields preserved
      expect(updated!.exerciseName).toBe("Running");
    });

    it("returns undefined when updating another user's log (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const log = await createExerciseLog({
        userId: otherUser.id,
        exerciseName: "Running",
        exerciseType: "cardio",
        durationMinutes: 30,
      });

      const updated = await updateExerciseLog(log.id, testUser.id, {
        durationMinutes: 999,
      });
      expect(updated).toBeUndefined();
    });

    it("returns undefined for non-existent log", async () => {
      const updated = await updateExerciseLog(999999, testUser.id, {
        durationMinutes: 60,
      });
      expect(updated).toBeUndefined();
    });
  });

  describe("deleteExerciseLog", () => {
    it("deletes an exercise log belonging to the user", async () => {
      const log = await createExerciseLog({
        userId: testUser.id,
        exerciseName: "Running",
        exerciseType: "cardio",
        durationMinutes: 30,
      });

      const deleted = await deleteExerciseLog(log.id, testUser.id);
      expect(deleted).toBe(true);

      const logs = await getExerciseLogs(testUser.id);
      expect(logs).toHaveLength(0);
    });

    it("returns false when deleting another user's log (IDOR)", async () => {
      const otherUser = await createTestUser(tx);
      const log = await createExerciseLog({
        userId: otherUser.id,
        exerciseName: "Running",
        exerciseType: "cardio",
        durationMinutes: 30,
      });

      const deleted = await deleteExerciseLog(log.id, testUser.id);
      expect(deleted).toBe(false);
    });
  });

  describe("getExerciseDailySummary", () => {
    it("returns zeros when no exercises logged for the day", async () => {
      const summary = await getExerciseDailySummary(
        testUser.id,
        new Date("2024-06-15"),
      );
      expect(summary.totalCaloriesBurned).toBe(0);
      expect(summary.totalMinutes).toBe(0);
      expect(summary.exerciseCount).toBe(0);
    });

    it("aggregates exercise data for the given day", async () => {
      const targetDate = new Date("2024-06-15T10:00:00Z");

      await createExerciseLog({
        userId: testUser.id,
        exerciseName: "Running",
        exerciseType: "cardio",
        durationMinutes: 30,
        caloriesBurned: "300.00",
        loggedAt: new Date("2024-06-15T08:00:00Z"),
      });
      await createExerciseLog({
        userId: testUser.id,
        exerciseName: "Yoga",
        exerciseType: "flexibility",
        durationMinutes: 60,
        caloriesBurned: "150.00",
        loggedAt: new Date("2024-06-15T18:00:00Z"),
      });
      // Different day -- should NOT be counted
      await createExerciseLog({
        userId: testUser.id,
        exerciseName: "Swimming",
        exerciseType: "cardio",
        durationMinutes: 45,
        caloriesBurned: "400.00",
        loggedAt: new Date("2024-06-16T08:00:00Z"),
      });

      const summary = await getExerciseDailySummary(testUser.id, targetDate);
      expect(summary.totalCaloriesBurned).toBe(450);
      expect(summary.totalMinutes).toBe(90);
      expect(summary.exerciseCount).toBe(2);
    });

    it("does not include another user's exercises", async () => {
      const otherUser = await createTestUser(tx);
      await createExerciseLog({
        userId: otherUser.id,
        exerciseName: "Running",
        exerciseType: "cardio",
        durationMinutes: 30,
        caloriesBurned: "300.00",
        loggedAt: new Date("2024-06-15T08:00:00Z"),
      });

      const summary = await getExerciseDailySummary(
        testUser.id,
        new Date("2024-06-15"),
      );
      expect(summary.exerciseCount).toBe(0);
    });
  });

  // ==========================================================================
  // EXERCISE LIBRARY
  // ==========================================================================

  describe("createExerciseLibraryEntry", () => {
    it("creates a library entry", async () => {
      const entry = await createExerciseLibraryEntry({
        name: "Burpees",
        type: "cardio",
        metValue: "8.0",
        isCustom: false,
      });
      expect(entry.id).toBeDefined();
      expect(entry.name).toBe("Burpees");
      expect(entry.type).toBe("cardio");
      expect(entry.metValue).toBe("8.0");
    });
  });

  describe("searchExerciseLibrary", () => {
    it("finds entries by partial name (ILIKE)", async () => {
      await createExerciseLibraryEntry({
        name: "Running - outdoor",
        type: "cardio",
        metValue: "9.8",
        isCustom: false,
      });
      await createExerciseLibraryEntry({
        name: "Bench Press",
        type: "strength",
        metValue: "3.5",
        isCustom: false,
      });

      const results = await searchExerciseLibrary("run");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Running - outdoor");
    });

    it("search is case-insensitive", async () => {
      await createExerciseLibraryEntry({
        name: "Jumping Jacks",
        type: "cardio",
        metValue: "8.0",
        isCustom: false,
      });

      const results = await searchExerciseLibrary("JUMPING");
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("Jumping Jacks");
    });

    it("returns global (non-custom) entries without userId", async () => {
      await createExerciseLibraryEntry({
        name: "Cycling",
        type: "cardio",
        metValue: "7.5",
        isCustom: false,
      });

      const results = await searchExerciseLibrary("Cycling");
      expect(results).toHaveLength(1);
    });

    it("returns custom entries only for the owning user", async () => {
      const otherUser = await createTestUser(tx);
      await createExerciseLibraryEntry({
        name: "My Custom Exercise",
        type: "strength",
        metValue: "5.0",
        isCustom: true,
        userId: otherUser.id,
      });

      // Search without userId: custom entry should NOT appear
      const noUser = await searchExerciseLibrary("My Custom");
      expect(noUser).toHaveLength(0);

      // Search as the owning user: custom entry SHOULD appear
      const ownerResults = await searchExerciseLibrary(
        "My Custom",
        otherUser.id,
      );
      expect(ownerResults).toHaveLength(1);
      expect(ownerResults[0].name).toBe("My Custom Exercise");

      // Search as a different user: custom entry should NOT appear
      const differentUser = await searchExerciseLibrary(
        "My Custom",
        testUser.id,
      );
      expect(differentUser).toHaveLength(0);
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

    it("returns all sync settings for the user", async () => {
      await upsertHealthKitSyncSetting(testUser.id, "weight", true);
      await upsertHealthKitSyncSetting(testUser.id, "steps", false);

      const settings = await getHealthKitSyncSettings(testUser.id);
      expect(settings).toHaveLength(2);
      const dataTypes = settings.map((s) => s.dataType).sort();
      expect(dataTypes).toEqual(["steps", "weight"]);
    });

    it("does not return another user's settings", async () => {
      const otherUser = await createTestUser(tx);
      await upsertHealthKitSyncSetting(otherUser.id, "weight", true);

      const settings = await getHealthKitSyncSettings(testUser.id);
      expect(settings).toHaveLength(0);
    });
  });

  describe("upsertHealthKitSyncSetting", () => {
    it("inserts a new sync setting", async () => {
      const setting = await upsertHealthKitSyncSetting(
        testUser.id,
        "weight",
        true,
      );
      expect(setting.userId).toBe(testUser.id);
      expect(setting.dataType).toBe("weight");
      expect(setting.enabled).toBe(true);
      expect(setting.syncDirection).toBe("read");
    });

    it("inserts with custom syncDirection", async () => {
      const setting = await upsertHealthKitSyncSetting(
        testUser.id,
        "exercise",
        true,
        "readwrite",
      );
      expect(setting.syncDirection).toBe("readwrite");
    });

    it("updates existing setting on conflict (same userId + dataType)", async () => {
      await upsertHealthKitSyncSetting(testUser.id, "weight", true);

      const updated = await upsertHealthKitSyncSetting(
        testUser.id,
        "weight",
        false,
      );
      expect(updated.enabled).toBe(false);
      // syncDirection should remain unchanged when not provided
      expect(updated.syncDirection).toBe("read");

      // Verify only one row exists
      const settings = await getHealthKitSyncSettings(testUser.id);
      const weightSettings = settings.filter((s) => s.dataType === "weight");
      expect(weightSettings).toHaveLength(1);
    });

    it("updates syncDirection when provided on conflict", async () => {
      await upsertHealthKitSyncSetting(testUser.id, "exercise", true, "read");

      const updated = await upsertHealthKitSyncSetting(
        testUser.id,
        "exercise",
        true,
        "readwrite",
      );
      expect(updated.syncDirection).toBe("readwrite");
    });
  });

  describe("updateHealthKitLastSync", () => {
    it("sets lastSyncAt to current time", async () => {
      await upsertHealthKitSyncSetting(testUser.id, "weight", true);
      const before = new Date();

      await updateHealthKitLastSync(testUser.id, "weight");

      const settings = await getHealthKitSyncSettings(testUser.id);
      const weightSetting = settings.find((s) => s.dataType === "weight");
      expect(weightSetting).toBeDefined();
      expect(weightSetting!.lastSyncAt).toBeInstanceOf(Date);
      expect(weightSetting!.lastSyncAt!.getTime()).toBeGreaterThanOrEqual(
        before.getTime() - 1000,
      );
    });

    it("does not throw when no matching row exists", async () => {
      // Should be a no-op (0 rows updated), not an error
      await expect(
        updateHealthKitLastSync(testUser.id, "nonexistent"),
      ).resolves.toBeUndefined();
    });
  });
});
