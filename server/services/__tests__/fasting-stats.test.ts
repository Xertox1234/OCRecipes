import { calculateFastingStats } from "../fasting-stats";

function makeFastingLog(overrides: {
  id?: number;
  startedAt: Date | string;
  endedAt?: Date | string | null;
  targetDurationHours?: number;
  actualDurationMinutes?: number | null;
  completed?: boolean | null;
  note?: string | null;
}) {
  return {
    id: overrides.id ?? 1,
    userId: "user-1",
    startedAt: overrides.startedAt,
    endedAt: overrides.endedAt ?? null,
    targetDurationHours: overrides.targetDurationHours ?? 16,
    actualDurationMinutes: overrides.actualDurationMinutes ?? null,
    completed: overrides.completed ?? false,
    note: overrides.note ?? null,
  };
}

describe("Fasting Stats", () => {
  describe("calculateFastingStats", () => {
    it("returns zeroed stats for empty logs", () => {
      const stats = calculateFastingStats([]);

      expect(stats.totalFasts).toBe(0);
      expect(stats.completedFasts).toBe(0);
      expect(stats.completionRate).toBe(0);
      expect(stats.currentStreak).toBe(0);
      expect(stats.longestStreak).toBe(0);
      expect(stats.averageDurationMinutes).toBe(0);
    });

    it("counts total and completed fasts correctly", () => {
      const logs = [
        makeFastingLog({
          startedAt: new Date("2026-02-20"),
          completed: true,
          actualDurationMinutes: 960,
        }),
        makeFastingLog({
          id: 2,
          startedAt: new Date("2026-02-21"),
          completed: false,
          actualDurationMinutes: 480,
        }),
        makeFastingLog({
          id: 3,
          startedAt: new Date("2026-02-22"),
          completed: true,
          actualDurationMinutes: 1000,
        }),
      ];

      const stats = calculateFastingStats(logs);

      expect(stats.totalFasts).toBe(3);
      expect(stats.completedFasts).toBe(2);
    });

    it("calculates completion rate as ratio of completed to total", () => {
      const logs = [
        makeFastingLog({
          startedAt: new Date("2026-02-20"),
          completed: true,
          actualDurationMinutes: 960,
        }),
        makeFastingLog({
          id: 2,
          startedAt: new Date("2026-02-21"),
          completed: false,
        }),
        makeFastingLog({
          id: 3,
          startedAt: new Date("2026-02-22"),
          completed: true,
          actualDurationMinutes: 960,
        }),
        makeFastingLog({
          id: 4,
          startedAt: new Date("2026-02-23"),
          completed: false,
        }),
      ];

      const stats = calculateFastingStats(logs);

      expect(stats.completionRate).toBe(0.5);
    });

    it("calculates average duration from completed fasts only", () => {
      const logs = [
        makeFastingLog({
          startedAt: new Date("2026-02-20"),
          completed: true,
          actualDurationMinutes: 960, // 16 hours
        }),
        makeFastingLog({
          id: 2,
          startedAt: new Date("2026-02-21"),
          completed: false,
          actualDurationMinutes: 120, // incomplete - should be excluded
        }),
        makeFastingLog({
          id: 3,
          startedAt: new Date("2026-02-22"),
          completed: true,
          actualDurationMinutes: 1080, // 18 hours
        }),
      ];

      const stats = calculateFastingStats(logs);

      // Average of 960 and 1080 = 1020
      expect(stats.averageDurationMinutes).toBe(1020);
    });

    it("handles all fasts incomplete (zero average duration)", () => {
      const logs = [
        makeFastingLog({
          startedAt: new Date("2026-02-20"),
          completed: false,
          actualDurationMinutes: 120,
        }),
        makeFastingLog({
          id: 2,
          startedAt: new Date("2026-02-21"),
          completed: false,
          actualDurationMinutes: 60,
        }),
      ];

      const stats = calculateFastingStats(logs);

      expect(stats.completedFasts).toBe(0);
      expect(stats.averageDurationMinutes).toBe(0);
      expect(stats.completionRate).toBe(0);
    });

    it("treats null actualDurationMinutes as 0 in average", () => {
      const logs = [
        makeFastingLog({
          startedAt: new Date("2026-02-20"),
          completed: true,
          actualDurationMinutes: null,
        }),
        makeFastingLog({
          id: 2,
          startedAt: new Date("2026-02-21"),
          completed: true,
          actualDurationMinutes: 960,
        }),
      ];

      const stats = calculateFastingStats(logs);

      // (0 + 960) / 2 = 480
      expect(stats.averageDurationMinutes).toBe(480);
    });

    it("calculates current streak for consecutive days ending today", () => {
      const today = new Date();
      const yesterday = new Date(Date.now() - 86400000);
      const twoDaysAgo = new Date(Date.now() - 86400000 * 2);

      const logs = [
        makeFastingLog({
          startedAt: today,
          completed: true,
          actualDurationMinutes: 960,
        }),
        makeFastingLog({
          id: 2,
          startedAt: yesterday,
          completed: true,
          actualDurationMinutes: 960,
        }),
        makeFastingLog({
          id: 3,
          startedAt: twoDaysAgo,
          completed: true,
          actualDurationMinutes: 960,
        }),
      ];

      const stats = calculateFastingStats(logs);

      expect(stats.currentStreak).toBe(3);
      expect(stats.longestStreak).toBe(3);
    });

    it("calculates current streak for consecutive days ending yesterday", () => {
      const yesterday = new Date(Date.now() - 86400000);
      const twoDaysAgo = new Date(Date.now() - 86400000 * 2);

      const logs = [
        makeFastingLog({
          startedAt: yesterday,
          completed: true,
          actualDurationMinutes: 960,
        }),
        makeFastingLog({
          id: 2,
          startedAt: twoDaysAgo,
          completed: true,
          actualDurationMinutes: 960,
        }),
      ];

      const stats = calculateFastingStats(logs);

      expect(stats.currentStreak).toBe(2);
    });

    it("resets current streak when most recent fast is older than yesterday", () => {
      const threeDaysAgo = new Date(Date.now() - 86400000 * 3);
      const fourDaysAgo = new Date(Date.now() - 86400000 * 4);

      const logs = [
        makeFastingLog({
          startedAt: threeDaysAgo,
          completed: true,
          actualDurationMinutes: 960,
        }),
        makeFastingLog({
          id: 2,
          startedAt: fourDaysAgo,
          completed: true,
          actualDurationMinutes: 960,
        }),
      ];

      const stats = calculateFastingStats(logs);

      expect(stats.currentStreak).toBe(0);
    });

    it("tracks longest streak separately from current streak", () => {
      const today = new Date();
      // Gap of 3 days, then a historical 4-day streak
      const sixDaysAgo = new Date(Date.now() - 86400000 * 6);
      const sevenDaysAgo = new Date(Date.now() - 86400000 * 7);
      const eightDaysAgo = new Date(Date.now() - 86400000 * 8);
      const nineDaysAgo = new Date(Date.now() - 86400000 * 9);

      const logs = [
        makeFastingLog({
          startedAt: today,
          completed: true,
          actualDurationMinutes: 960,
        }),
        makeFastingLog({
          id: 2,
          startedAt: sixDaysAgo,
          completed: true,
          actualDurationMinutes: 960,
        }),
        makeFastingLog({
          id: 3,
          startedAt: sevenDaysAgo,
          completed: true,
          actualDurationMinutes: 960,
        }),
        makeFastingLog({
          id: 4,
          startedAt: eightDaysAgo,
          completed: true,
          actualDurationMinutes: 960,
        }),
        makeFastingLog({
          id: 5,
          startedAt: nineDaysAgo,
          completed: true,
          actualDurationMinutes: 960,
        }),
      ];

      const stats = calculateFastingStats(logs);

      expect(stats.currentStreak).toBe(1);
      expect(stats.longestStreak).toBe(4);
    });

    it("handles single completed fast today as streak of 1", () => {
      const today = new Date();

      const logs = [
        makeFastingLog({
          startedAt: today,
          completed: true,
          actualDurationMinutes: 960,
        }),
      ];

      const stats = calculateFastingStats(logs);

      expect(stats.currentStreak).toBe(1);
      expect(stats.longestStreak).toBe(1);
    });

    it("ignores incomplete fasts for streak calculation", () => {
      const today = new Date();
      const yesterday = new Date(Date.now() - 86400000);

      const logs = [
        makeFastingLog({
          startedAt: today,
          completed: true,
          actualDurationMinutes: 960,
        }),
        makeFastingLog({
          id: 2,
          startedAt: yesterday,
          completed: false, // not counted for streaks
          actualDurationMinutes: 480,
        }),
      ];

      const stats = calculateFastingStats(logs);

      // Only today counts since yesterday was incomplete
      expect(stats.currentStreak).toBe(1);
    });

    it("handles string dates in startedAt", () => {
      const logs = [
        makeFastingLog({
          startedAt: new Date().toISOString(),
          completed: true,
          actualDurationMinutes: 960,
        }),
      ];

      const stats = calculateFastingStats(logs);

      expect(stats.totalFasts).toBe(1);
      expect(stats.completedFasts).toBe(1);
    });

    it("deduplicates same-day fasts for streak counting", () => {
      const todayStr = new Date().toISOString().split("T")[0];
      const todayMorning = new Date(todayStr + "T08:00:00Z");
      const todayEvening = new Date(todayStr + "T14:00:00Z");

      const logs = [
        makeFastingLog({
          startedAt: todayMorning,
          completed: true,
          actualDurationMinutes: 960,
        }),
        makeFastingLog({
          id: 2,
          startedAt: todayEvening,
          completed: true,
          actualDurationMinutes: 480,
        }),
      ];

      const stats = calculateFastingStats(logs);

      // Two fasts on the same day should count as streak of 1 day
      expect(stats.currentStreak).toBe(1);
    });
  });
});
