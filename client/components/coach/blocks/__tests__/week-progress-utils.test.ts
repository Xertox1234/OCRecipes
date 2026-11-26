import { describe, it, expect } from "vitest";
import type { WeekCaloriesResponse } from "@/hooks/useWeekCalories";
import {
  liveWeek,
  weekBars,
  weekDates,
  weekSpoken,
  weekSummary,
  weekTitle,
} from "../week-progress-utils";

describe("weekDates", () => {
  it("is the last day and the six before it, oldest first", () => {
    expect(weekDates("2026-11-26")).toEqual([
      "2026-11-20",
      "2026-11-21",
      "2026-11-22",
      "2026-11-23",
      "2026-11-24",
      "2026-11-25",
      "2026-11-26",
    ]);
  });

  it("crosses a month and a year", () => {
    expect(weekDates("2026-01-02")).toEqual([
      "2025-12-27",
      "2025-12-28",
      "2025-12-29",
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
    ]);
  });

  it("crosses a clock change without losing or repeating a day", () => {
    // US clocks went back on 2026-11-01.
    const dates = weekDates("2026-11-04");
    expect(dates[0]).toBe("2026-10-29");
    expect(new Set(dates).size).toBe(7);
  });
});

describe("liveWeek", () => {
  const read = (calories: unknown[], endDate = "2026-11-20") => ({
    data: { endDate, calories } as unknown as WeekCaloriesResponse,
    isError: false,
  });

  it("is the week's calories once its read is in", () => {
    const r = read([100, 200, 300, 400, 500, 600, 700]);
    expect(liveWeek(r.data, r.isError, "2026-11-20")).toEqual([
      100, 200, 300, 400, 500, 600, 700,
    ]);
  });

  it("reads a sum that came back as a string, and a bad one as 0", () => {
    const r = read(["1420.5", null, "abc", -5, 0, 1800, "2000"]);
    expect(liveWeek(r.data, false, "2026-11-20")).toEqual([
      1420.5, 0, 0, 0, 0, 1800, 2000,
    ]);
  });

  it("is nothing while loading, after a failed read, or for another week", () => {
    const r = read([1, 2, 3, 4, 5, 6, 7]);
    expect(liveWeek(undefined, false, "2026-11-20")).toBeUndefined();
    expect(liveWeek(r.data, true, "2026-11-20")).toBeUndefined();
    expect(liveWeek(r.data, false, "2026-11-21")).toBeUndefined();
    expect(liveWeek(read([1, 2, 3]).data, false, "2026-11-20")).toBeUndefined();
  });
});

describe("weekBars", () => {
  const dates = weekDates("2026-11-26");

  it("labels each day, names today, and marks a day over the goal", () => {
    const bars = weekBars(
      [1800, 2100, 0, 1950, 2400, 1700, 1420],
      2000,
      dates,
      "2026-11-26",
    );
    expect(bars.map((b) => b.label)).toEqual([
      "Fri",
      "Sat",
      "Sun",
      "Mon",
      "Tue",
      "Wed",
      "Today",
    ]);
    expect(bars.map((b) => b.over)).toEqual([
      false,
      true,
      false,
      false,
      true,
      false,
      false,
    ]);
    expect(bars[2]).toMatchObject({ logged: false, text: "—", height: 0 });
    expect(bars[0].text).toBe("1,800");
  });

  it("scales to the tallest bar, or to the goal when every day is under it", () => {
    const over = weekBars([2400, 1200, 0, 0, 0, 0, 0], 2000, dates, "x");
    expect(over[0].height).toBe(1);
    expect(over[1].height).toBe(0.5);
    const under = weekBars([1000, 0, 0, 0, 0, 0, 0], 2000, dates, "x");
    expect(under[0].height).toBe(0.5);
  });

  it("does not count a day as over for a fraction of a calorie", () => {
    expect(weekBars([2000.4, 0, 0, 0, 0, 0, 0], 2000, dates, "x")[0].over).toBe(
      false,
    );
  });
});

describe("goal line and summary", () => {
  it("averages only the days with something logged", () => {
    const s = weekSummary([1800, 2200, 0, 0, 2000, 0, 0], 2000, false);
    expect(s.text).toBe("Average 2,000 cal over 3 days logged · goal 2,000");
    expect(s.goalAt).toBe(2000 / 2200);
  });

  it("leaves today out of the average while the week ends today", () => {
    // A breakfast-only today would pull the average down.
    expect(weekSummary([1800, 2200, 0, 0, 2000, 0, 400], 2000, true).text).toBe(
      "Average 2,000 cal over 3 days logged, not counting today · goal 2,000",
    );
    expect(weekSummary([0, 0, 0, 0, 0, 0, 400], 2000, true).text).toBe(
      "Nothing logged before today · goal 2,000",
    );
  });

  it("puts the goal line at the top when no day passes it", () => {
    expect(weekSummary([1000, 0, 0, 0, 0, 0, 0], 2000, false).goalAt).toBe(1);
  });

  it("says one day, and says when nothing was logged", () => {
    expect(weekSummary([1500, 0, 0, 0, 0, 0, 0], 2000, false).text).toBe(
      "Average 1,500 cal over 1 day logged · goal 2,000",
    );
    expect(weekSummary([0, 0, 0, 0, 0, 0, 0], 2000, false).text).toBe(
      "Nothing logged these seven days · goal 2,000",
    );
  });
});

describe("weekTitle and weekSpoken", () => {
  it("is the last seven days when it ends today, else names the last day", () => {
    expect(weekTitle("2026-11-26", "2026-11-26")).toBe("Last 7 days");
    expect(weekTitle("2026-11-20", "2026-11-26")).toBe("7 days to Fri, Nov 20");
  });

  it("reads every day, the summary, and says when it is the reply's numbers", () => {
    const dates = weekDates("2026-11-26");
    const calories = [1800, 2100, 0, 1950, 2400, 1700, 1420];
    const bars = weekBars(calories, 2000, dates, "2026-11-26");
    const summary = weekSummary(calories, 2000, true);
    const live = weekSpoken("Last 7 days", bars, summary.text, true);
    expect(live).toContain("Last 7 days. ");
    expect(live).toContain("Friday: 1,800 calories");
    expect(live).toContain("Saturday: 2,100 calories, over the goal");
    expect(live).toContain("Sunday: nothing logged");
    expect(live).toContain("Today: 1,420 calories");
    expect(live).not.toContain("As of the Coach's reply");
    expect(weekSpoken("Last 7 days", bars, summary.text, false)).toMatch(
      /As of the Coach's reply\.$/,
    );
  });
});
