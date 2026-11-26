import { describe, it, expect, vi, beforeEach } from "vitest";
import { storage } from "../../storage";
import { buildWeekProgressBlock, readWeekCalories } from "../week-progress";
import { isWeekProgressRequest } from "../day-progress-request";
import { coachBlockSchema } from "@shared/schemas/coach-blocks";
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";
import { civilDateString } from "../../lib/civil-date";

vi.mock("../../storage", () => ({
  storage: { getDailySummary: vi.fn() },
}));

type Summary = Awaited<ReturnType<typeof storage.getDailySummary>>;
const summary = (calories: unknown) =>
  ({
    totalCalories: calories,
    totalProtein: 0,
    totalCarbs: 0,
    totalFat: 0,
    itemCount: 1,
  }) as Record<string, unknown> as Summary;

// 03:30 UTC on the 27th is still the 26th in Los Angeles.
const NOW = new Date("2026-11-27T03:30:00Z");
const TZ = "America/Los_Angeles";

describe("isWeekProgressRequest", () => {
  it("reads the request, whatever the model added", () => {
    expect(isWeekProgressRequest({ type: "week_progress" })).toBe(true);
    expect(
      isWeekProgressRequest({ type: "week_progress", snapshot: { a: 1 } }),
    ).toBe(true);
  });

  it("is not a request for another block or a non-object", () => {
    for (const raw of [{ type: "day_progress" }, null, "week_progress", []]) {
      expect(isWeekProgressRequest(raw)).toBe(false);
    }
  });
});

describe("buildWeekProgressBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the seven local days ending today, oldest first", async () => {
    // Each day's calories are its day of the month, so the order shows.
    vi.mocked(storage.getDailySummary).mockImplementation(async (_u, at, tz) =>
      summary(Number(civilDateString(at, tz).slice(8))),
    );
    const block = await buildWeekProgressBlock({
      userId: "1",
      tz: TZ,
      now: NOW,
      user: { dailyCalorieGoal: 2100 },
    });
    expect(block).toEqual({
      type: "week_progress",
      endDate: "2026-11-26",
      snapshot: {
        calories: [20, 21, 22, 23, 24, 25, 26],
        calorieGoal: 2100,
      },
    });
    expect(coachBlockSchema.safeParse(block).success).toBe(true);
    expect(storage.getDailySummary).toHaveBeenCalledTimes(7);
    for (const call of vi.mocked(storage.getDailySummary).mock.calls) {
      expect(call[0]).toBe("1");
      expect(call[2]).toBe(TZ);
    }
  });

  it("reads a sum that came back as a string, and a bad one as 0", async () => {
    const values: unknown[] = ["1420.5", null, "abc", -5, 0, 1800, "2000"];
    let i = 0;
    vi.mocked(storage.getDailySummary).mockImplementation(async () =>
      summary(values[i++]),
    );
    const block = await buildWeekProgressBlock({
      userId: "1",
      tz: TZ,
      now: NOW,
      user: { dailyCalorieGoal: 2100 },
    });
    expect(block.snapshot.calories).toEqual([1420.5, 0, 0, 0, 0, 1800, 2000]);
  });

  it("uses the app's default for an unset calorie goal", async () => {
    vi.mocked(storage.getDailySummary).mockResolvedValue(summary(0));
    const block = await buildWeekProgressBlock({
      userId: "1",
      tz: TZ,
      now: NOW,
      user: { dailyCalorieGoal: null },
    });
    expect(block.snapshot.calorieGoal).toBe(DEFAULT_NUTRITION_GOALS.calories);
  });

  it("fails when a day can't be read", async () => {
    vi.mocked(storage.getDailySummary).mockRejectedValue(new Error("db down"));
    await expect(
      buildWeekProgressBlock({
        userId: "1",
        tz: TZ,
        now: NOW,
        user: { dailyCalorieGoal: 2100 },
      }),
    ).rejects.toThrow("db down");
  });
});

describe("readWeekCalories", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads the seven days ending on the date given, oldest first", async () => {
    vi.mocked(storage.getDailySummary).mockImplementation(async (_u, at, tz) =>
      summary(Number(civilDateString(at, tz).slice(8))),
    );
    // Across the US clock change on 2026-11-01: seven distinct days.
    await expect(readWeekCalories("1", "2026-11-04", TZ)).resolves.toEqual([
      29, 30, 31, 1, 2, 3, 4,
    ]);
  });

  it("reads one day at a time, so a card holds one database connection", async () => {
    let open = 0;
    let most = 0;
    vi.mocked(storage.getDailySummary).mockImplementation(async () => {
      open++;
      most = Math.max(most, open);
      await new Promise((r) => setTimeout(r, 1));
      open--;
      return summary(100);
    });
    await readWeekCalories("1", "2026-11-26", TZ);
    expect(most).toBe(1);
    expect(storage.getDailySummary).toHaveBeenCalledTimes(7);
  });
});
