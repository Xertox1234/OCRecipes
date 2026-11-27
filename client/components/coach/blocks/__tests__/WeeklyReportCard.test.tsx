// @vitest-environment jsdom
import React from "react";
import { fireEvent, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { renderComponent } from "../../../../../test/utils/render-component";
import BlockRenderer from "../index";
import type { WeeklyReportBlock } from "@shared/schemas/coach-blocks";

const mockNavigate = vi.fn();
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

const block: WeeklyReportBlock = {
  type: "weekly_report",
  reportId: 12,
  weekStart: "2026-11-15",
  weekEnd: "2026-11-21",
  headline: "Five days logged",
  daysActive: 5,
  mealsLogged: 14,
  proteinDaysMet: null,
};

describe("WeeklyReportCard", () => {
  it("shows the week, the headline and the counts", () => {
    renderComponent(<BlockRenderer block={block} />);
    expect(screen.getByText("Your week · Nov 15–21")).toBeTruthy();
    expect(screen.getByText("Five days logged")).toBeTruthy();
    expect(screen.getByText("5 of 7 days logged")).toBeTruthy();
    expect(screen.getByText("14 meals")).toBeTruthy();
    expect(screen.queryByText(/Protein goal/)).toBeNull();
  });

  it("opens the full report on a tap", () => {
    renderComponent(<BlockRenderer block={block} />);
    fireEvent.click(screen.getByTestId("weekly-report-card"));
    expect(mockNavigate).toHaveBeenCalledWith(
      "Main",
      {
        screen: "ProfileTab",
        params: { screen: "WeeklyReport", params: { id: 12 } },
      },
      { pop: true },
    );
  });
});
