import { describe, it, expect } from "vitest";
import {
  dayProgressRows,
  dayProgressSpoken,
  dayProgressTitle,
  liveGoals,
  liveTotals,
} from "../day-progress-utils";
import { DEFAULT_NUTRITION_GOALS } from "@shared/constants/nutrition";

const TOTALS = { calories: 1420.4, protein: 82, carbs: 150, fat: 80 };
const GOALS = { calories: 2000, protein: 150, carbs: 250, fat: 67 };

describe("dayProgressRows", () => {
  it("gives each total against its goal, rounded, with how full the bar is", () => {
    const rows = dayProgressRows(TOTALS, GOALS);
    expect(rows.map((r) => r.label)).toEqual([
      "Calories",
      "Protein",
      "Carbs",
      "Fat",
    ]);
    expect(rows[0]).toMatchObject({
      text: "1,420 / 2,000 cal",
      fraction: 0.71,
      over: false,
    });
    expect(rows[1].text).toBe("82 / 150 g");
  });

  it("fills the bar no further than full, and says when a total is over", () => {
    const fat = dayProgressRows(TOTALS, GOALS)[3];
    expect(fat.fraction).toBe(1);
    expect(fat.over).toBe(true);
  });

  it("shows a total with no goal (0) as just the total, never over", () => {
    const row = dayProgressRows(TOTALS, { ...GOALS, protein: 0 })[1];
    expect(row).toMatchObject({
      text: "82 g · no goal set",
      fraction: 0,
      over: false,
      spoken: "Protein: 82 grams, no goal set",
    });
  });
});

describe("liveTotals / liveGoals", () => {
  it("reads the day's summary, numbers that came as strings included", () => {
    expect(
      liveTotals({
        totalCalories: "1500.5" as unknown as number,
        totalProtein: 90,
        totalCarbs: 160,
        totalFat: 50,
        itemCount: 5,
      }),
    ).toEqual({ calories: 1500.5, protein: 90, carbs: 160, fat: 50 });
  });

  it("is nothing while the summary has not loaded", () => {
    expect(liveTotals(undefined)).toBeUndefined();
    expect(liveGoals(undefined)).toBeUndefined();
  });

  it("uses the calorie default and no macro goal for one not set, as the server does", () => {
    expect(
      liveGoals({
        dailyCalorieGoal: null,
        dailyProteinGoal: 120,
        dailyCarbsGoal: 0,
        dailyFatGoal: null,
        goalsCalculatedAt: null,
      }),
    ).toEqual({
      calories: DEFAULT_NUTRITION_GOALS.calories,
      protein: 120,
      carbs: 0,
      fat: 0,
    });
  });
});

describe("dayProgressTitle", () => {
  it("names the day from the phone's today", () => {
    expect(dayProgressTitle("2026-11-26", "2026-11-26")).toBe("Today so far");
    expect(dayProgressTitle("2026-11-25", "2026-11-26")).toBe("Yesterday");
    // Across a month end.
    expect(dayProgressTitle("2026-11-30", "2026-12-01")).toBe("Yesterday");
    expect(dayProgressTitle("2026-11-20", "2026-11-26")).toBe("Fri, Nov 20");
  });
});

describe("dayProgressSpoken", () => {
  it("says every row, and whether the numbers are the latest", () => {
    const rows = dayProgressRows(TOTALS, GOALS);
    expect(dayProgressSpoken("Today so far", rows, true)).toBe(
      "Today so far. Calories: 1,420 of 2,000. Protein: 82 of 150 grams. " +
        "Carbs: 150 of 250 grams. Fat: 80 of 67 grams, over the goal.",
    );
    expect(dayProgressSpoken("Today so far", rows, false)).toMatch(
      /As of the Coach's reply\.$/,
    );
  });
});
