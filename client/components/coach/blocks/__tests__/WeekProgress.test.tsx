// @vitest-environment jsdom
import React from "react";
import { act, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderComponent } from "../../../../../test/utils/render-component";
import WeekProgress from "../WeekProgress";
import type { WeekProgressBlock } from "@shared/schemas/coach-blocks";
import { useWeekCalories } from "@/hooks/useWeekCalories";

vi.mock("@/hooks/useWeekCalories", () => ({ useWeekCalories: vi.fn() }));

const { goalsResult } = vi.hoisted(() => ({
  goalsResult: { current: { data: undefined, isError: false } as unknown },
}));
vi.mock("@tanstack/react-query", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-query")>()),
  useQuery: () => goalsResult.current,
}));

const block: WeekProgressBlock = {
  type: "week_progress",
  endDate: "2026-11-20",
  snapshot: {
    calories: [1800, 2100, 0, 1950, 2400, 1700, 1420],
    calorieGoal: 2000,
  },
};

const weekRead = (data: unknown, isError = false) =>
  ({ data, isError }) as unknown as ReturnType<typeof useWeekCalories>;
const loaded = (calories: number[]) =>
  weekRead({ endDate: "2026-11-20", calories });

const GOALS = {
  dailyCalorieGoal: 2200,
  dailyProteinGoal: 150,
  dailyCarbsGoal: 250,
  dailyFatGoal: 67,
  goalsCalculatedAt: null,
};

describe("WeekProgress", () => {
  beforeEach(() => {
    vi.mocked(useWeekCalories).mockReturnValue(weekRead(undefined));
    goalsResult.current = { data: undefined, isError: false };
  });

  it("reads the block's seven days, and shows the reply's numbers until they load", () => {
    renderComponent(<WeekProgress block={block} />);
    expect(useWeekCalories).toHaveBeenCalledWith("2026-11-20");
    expect(screen.getByText("1,800")).toBeTruthy();
    expect(
      screen.getByText("Average 1,895 cal over 6 days logged · goal 2,000"),
    ).toBeTruthy();
    expect(screen.getByText("As of the Coach's reply")).toBeTruthy();
  });

  it("shows the week as it is now once every read arrives", () => {
    vi.mocked(useWeekCalories).mockReturnValue(
      loaded([2000, 2000, 2000, 2000, 2000, 2000, 2300]),
    );
    goalsResult.current = { data: GOALS, isError: false };
    renderComponent(<WeekProgress block={block} />);
    expect(screen.getByText("2,300")).toBeTruthy();
    expect(
      screen.getByText("Average 2,043 cal over 7 days logged · goal 2,200"),
    ).toBeTruthy();
    expect(screen.getByText("Updates as you log")).toBeTruthy();
  });

  it("keeps the reply's week when the latest read failed", () => {
    // A refetch that failed keeps older data: not shown as if it were live.
    vi.mocked(useWeekCalories).mockReturnValue(
      weekRead(
        { endDate: "2026-11-20", calories: [1, 1, 1, 1, 1, 1, 1] },
        true,
      ),
    );
    goalsResult.current = { data: GOALS, isError: false };
    renderComponent(<WeekProgress block={block} />);
    expect(screen.getByText("1,800")).toBeTruthy();
    expect(screen.getByText("As of the Coach's reply")).toBeTruthy();
  });

  it("keeps the reply's week when the goals can't be read", () => {
    vi.mocked(useWeekCalories).mockReturnValue(loaded([1, 1, 1, 1, 1, 1, 1]));
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

  describe("when the day turns while the card is on screen", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 10, 20, 23, 50, 0));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("stops calling it the last seven days without leaving the chat", () => {
      renderComponent(<WeekProgress block={block} />);
      expect(screen.getByText("Last 7 days")).toBeTruthy();

      act(() => {
        vi.advanceTimersByTime(11 * 60 * 1000);
      });
      expect(screen.getByText("7 days to Fri, Nov 20")).toBeTruthy();
      expect(screen.queryByText("Last 7 days")).toBeNull();
    });
  });
});
