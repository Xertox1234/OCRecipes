// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderComponent } from "../../../../../test/utils/render-component";
import DayProgress from "../DayProgress";
import { useDailySummary } from "@/hooks/useDailySummary";
import type { DayProgressBlock } from "@shared/schemas/coach-blocks";

vi.mock("@/hooks/useDailySummary", () => ({ useDailySummary: vi.fn() }));

const { goalsResult } = vi.hoisted(() => ({
  goalsResult: { current: { data: undefined, isError: false } as unknown },
}));
vi.mock("@tanstack/react-query", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-query")>()),
  useQuery: () => goalsResult.current,
}));

const block: DayProgressBlock = {
  type: "day_progress",
  date: "2026-11-20",
  snapshot: {
    totals: { calories: 900, protein: 40, carbs: 100, fat: 30 },
    goals: { calories: 2000, protein: 150, carbs: 250, fat: 67 },
  },
};

const summary = (data: unknown, isError = false) =>
  ({ data, isError }) as unknown as ReturnType<typeof useDailySummary>;

describe("DayProgress", () => {
  beforeEach(() => {
    vi.mocked(useDailySummary).mockReturnValue(summary(undefined));
    goalsResult.current = { data: undefined, isError: false };
  });

  it("reads the block's own day, and shows the reply's numbers until it loads", () => {
    renderComponent(<DayProgress block={block} />);
    expect(useDailySummary).toHaveBeenCalledWith("2026-11-20");
    expect(screen.getByText("900 / 2,000 cal")).toBeTruthy();
    expect(screen.getByText("As of the Coach's reply")).toBeTruthy();
  });

  it("shows the day as it is now once the reads arrive", () => {
    vi.mocked(useDailySummary).mockReturnValue(
      summary({
        totalCalories: 1850,
        totalProtein: 120,
        totalCarbs: 200,
        totalFat: 70,
        itemCount: 6,
      }),
    );
    goalsResult.current = {
      data: {
        dailyCalorieGoal: 2200,
        dailyProteinGoal: 150,
        dailyCarbsGoal: 250,
        dailyFatGoal: 67,
        goalsCalculatedAt: null,
      },
      isError: false,
    };
    renderComponent(<DayProgress block={block} />);
    expect(screen.getByText("1,850 / 2,200 cal")).toBeTruthy();
    expect(screen.getByText("70 / 67 g · over")).toBeTruthy();
    expect(screen.getByText("Updates as you log")).toBeTruthy();
    expect(
      screen.getByLabelText(
        /Calories: 1,850 of 2,200\. .*Fat: 70 of 67 grams, over the goal\.$/,
      ),
    ).toBeTruthy();
  });

  it("falls back to the reply's numbers when a read fails", () => {
    // A refetch that failed keeps older data: not shown as if it were live.
    vi.mocked(useDailySummary).mockReturnValue(
      summary(
        {
          totalCalories: 1200,
          totalProtein: 60,
          totalCarbs: 120,
          totalFat: 40,
          itemCount: 3,
        },
        true,
      ),
    );
    goalsResult.current = {
      data: {
        dailyCalorieGoal: 2200,
        dailyProteinGoal: 150,
        dailyCarbsGoal: 250,
        dailyFatGoal: 67,
        goalsCalculatedAt: null,
      },
      isError: false,
    };
    renderComponent(<DayProgress block={block} />);
    expect(screen.getByText("900 / 2,000 cal")).toBeTruthy();
    expect(screen.getByText("As of the Coach's reply")).toBeTruthy();
  });
});
