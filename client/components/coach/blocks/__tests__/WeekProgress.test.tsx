// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderComponent } from "../../../../../test/utils/render-component";
import WeekProgress from "../WeekProgress";
import type { WeekProgressBlock } from "@shared/schemas/coach-blocks";

const { reads, goalsResult, queriesAsked } = vi.hoisted(() => ({
  reads: { current: [] as unknown[] },
  goalsResult: { current: { data: undefined, isError: false } as unknown },
  queriesAsked: { current: [] as { queryKey: readonly unknown[] }[] },
}));
vi.mock("@tanstack/react-query", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-query")>()),
  useQuery: () => goalsResult.current,
  useQueries: ({ queries }: { queries: { queryKey: unknown[] }[] }) => {
    queriesAsked.current = queries;
    return reads.current;
  },
}));

const block: WeekProgressBlock = {
  type: "week_progress",
  endDate: "2026-11-20",
  snapshot: {
    calories: [1800, 2100, 0, 1950, 2400, 1700, 1420],
    calorieGoal: 2000,
  },
};

const loading = () =>
  Array.from({ length: 7 }, () => ({ data: undefined, isError: false }));
const loaded = (calories: number[]) =>
  calories.map((totalCalories) => ({
    data: {
      totalCalories,
      totalProtein: 0,
      totalCarbs: 0,
      totalFat: 0,
      itemCount: 1,
    },
    isError: false,
  }));
const GOALS = {
  dailyCalorieGoal: 2200,
  dailyProteinGoal: 150,
  dailyCarbsGoal: 250,
  dailyFatGoal: 67,
  goalsCalculatedAt: null,
};

describe("WeekProgress", () => {
  beforeEach(() => {
    reads.current = loading();
    goalsResult.current = { data: undefined, isError: false };
  });

  it("reads the block's seven days, and shows the reply's numbers until they load", () => {
    renderComponent(<WeekProgress block={block} />);
    expect(queriesAsked.current.map((q) => q.queryKey)).toEqual(
      [14, 15, 16, 17, 18, 19, 20].map((d) => [
        "/api/daily-summary",
        `2026-11-${d}`,
      ]),
    );
    expect(screen.getByText("1,800")).toBeTruthy();
    expect(
      screen.getByText("Average 1,895 cal over 6 days logged · goal 2,000"),
    ).toBeTruthy();
    expect(screen.getByText("As of the Coach's reply")).toBeTruthy();
  });

  it("shows the week as it is now once every read arrives", () => {
    reads.current = loaded([2000, 2000, 2000, 2000, 2000, 2000, 2300]);
    goalsResult.current = { data: GOALS, isError: false };
    renderComponent(<WeekProgress block={block} />);
    expect(screen.getByText("2,300")).toBeTruthy();
    expect(
      screen.getByText("Average 2,043 cal over 7 days logged · goal 2,200"),
    ).toBeTruthy();
    expect(screen.getByText("Updates as you log")).toBeTruthy();
  });

  it("keeps the reply's week while one day is still loading or failed", () => {
    reads.current = [
      ...loaded([1, 1, 1, 1, 1, 1]),
      { data: undefined, isError: true },
    ];
    goalsResult.current = { data: GOALS, isError: false };
    renderComponent(<WeekProgress block={block} />);
    expect(screen.getByText("1,800")).toBeTruthy();
    expect(screen.getByText("As of the Coach's reply")).toBeTruthy();
  });

  it("keeps the reply's week when the goals can't be read", () => {
    reads.current = loaded([1, 1, 1, 1, 1, 1, 1]);
    goalsResult.current = { data: GOALS, isError: true };
    renderComponent(<WeekProgress block={block} />);
    expect(screen.getByText("As of the Coach's reply")).toBeTruthy();
  });

  it("is one stop for VoiceOver that reads every day", () => {
    renderComponent(<WeekProgress block={block} />);
    expect(
      screen.getByLabelText(
        /^7 days to Fri, Nov 20\. .*Monday: nothing logged\. .*Wednesday: 2,400 calories, over the goal\. .*As of the Coach's reply\.$/,
      ),
    ).toBeTruthy();
  });
});
