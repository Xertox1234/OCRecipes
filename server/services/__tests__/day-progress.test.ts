import { describe, it, expect, vi, beforeEach } from "vitest";
import { storage } from "../../storage";
import { buildDayProgressBlock } from "../day-progress";
import { readDayProgressRequest } from "../day-progress-request";
import { coachBlockSchema } from "@shared/schemas/coach-blocks";
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";

vi.mock("../../storage", () => ({
  storage: { getDailySummary: vi.fn() },
}));

const USER = {
  dailyCalorieGoal: 2100,
  dailyProteinGoal: 140,
  dailyCarbsGoal: 230,
  dailyFatGoal: 70,
};
// 03:30 UTC on the 27th is still the 26th in Los Angeles.
const NOW = new Date("2026-11-27T03:30:00Z");
const TZ = "America/Los_Angeles";

describe("readDayProgressRequest", () => {
  it("reads the day the model asked for", () => {
    expect(readDayProgressRequest({ type: "day_progress", day: "today" })).toBe(
      "today",
    );
    expect(
      readDayProgressRequest({ type: "day_progress", day: "yesterday" }),
    ).toBe("yesterday");
  });

  it("ignores anything the model added, numbers included", () => {
    expect(
      readDayProgressRequest({
        type: "day_progress",
        day: "today",
        snapshot: { totals: { calories: 1 } },
      }),
    ).toBe("today");
  });

  it("is not a request without a day it can read, or for another block", () => {
    for (const raw of [
      { type: "day_progress" },
      { type: "day_progress", day: "tomorrow" },
      { type: "day_progress", date: "2026-11-26" },
      { type: "inline_chart", day: "today" },
      null,
      "day_progress",
    ]) {
      expect(readDayProgressRequest(raw)).toBeUndefined();
    }
  });
});

describe("buildDayProgressBlock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getDailySummary).mockResolvedValue({
      totalCalories: 1420.4,
      totalProtein: 82,
      totalCarbs: 150,
      totalFat: 48,
      itemCount: 4,
    });
  });

  it("stores the user's local date and the day's numbers as they are now", async () => {
    const block = await buildDayProgressBlock("today", {
      userId: "1",
      tz: TZ,
      now: NOW,
      user: USER,
    });
    expect(block).toEqual({
      type: "day_progress",
      date: "2026-11-26",
      snapshot: {
        totals: { calories: 1420.4, protein: 82, carbs: 150, fat: 48 },
        goals: { calories: 2100, protein: 140, carbs: 230, fat: 70 },
      },
    });
    expect(coachBlockSchema.safeParse(block).success).toBe(true);
    const [userId, instant, tz] = vi.mocked(storage.getDailySummary).mock
      .calls[0];
    expect(userId).toBe("1");
    expect(tz).toBe(TZ);
    // An instant inside the 26th in Los Angeles, not UTC's 27th.
    expect(
      new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(instant),
    ).toBe("2026-11-26");
  });

  it("reads yesterday as the day before the user's today", async () => {
    const block = await buildDayProgressBlock("yesterday", {
      userId: "1",
      tz: TZ,
      now: NOW,
      user: USER,
    });
    expect(block.date).toBe("2026-11-25");
  });

  it("falls back to the app's calorie default, and leaves a macro goal not set at 0", async () => {
    const block = await buildDayProgressBlock("today", {
      userId: "1",
      tz: TZ,
      now: NOW,
      user: {
        dailyCalorieGoal: null,
        dailyProteinGoal: 0,
        dailyCarbsGoal: null,
        dailyFatGoal: 55,
      },
    });
    // As the Coach's own context and the day detail screen read them:
    // 0 is "no goal", never a target the user didn't pick.
    expect(block.snapshot.goals).toEqual({
      calories: DEFAULT_NUTRITION_GOALS.calories,
      protein: 0,
      carbs: 0,
      fat: 55,
    });
  });

  it("reads totals the database returns as strings, and a bad one as 0", async () => {
    // What node-postgres hands back for a SUM: a string (seen on the dev DB).
    const fromDb: Record<string, unknown> = {
      totalCalories: "1420.5",
      totalProtein: "82",
      totalCarbs: "abc",
      totalFat: -3,
      itemCount: "4",
    };
    vi.mocked(storage.getDailySummary).mockResolvedValue(
      fromDb as Awaited<ReturnType<typeof storage.getDailySummary>>,
    );
    const block = await buildDayProgressBlock("today", {
      userId: "1",
      tz: TZ,
      now: NOW,
      user: USER,
    });
    expect(block.snapshot.totals).toEqual({
      calories: 1420.5,
      protein: 82,
      carbs: 0,
      fat: 0,
    });
  });
});
