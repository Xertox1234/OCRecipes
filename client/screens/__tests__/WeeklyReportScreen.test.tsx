// @vitest-environment jsdom
//
// Coach chat audit 2026-11-24 L83: "Add to my plan" had no in-flight guard,
// so a double tap (or a second tap on a slow connection) planned the recipe
// twice, with two success toasts.
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import {
  createMockWeeklyFacts,
  createMockWeeklyReportContent,
} from "../../../server/__tests__/factories";
import WeeklyReportScreen from "../WeeklyReportScreen";

const h = vi.hoisted(() => ({
  addToPlan: vi.fn(),
  report: undefined as unknown,
}));

vi.mock("@/hooks/useWeeklyReports", () => ({
  useWeeklyReport: () => ({
    data: h.report,
    isError: false,
    refetch: vi.fn(),
  }),
  useMarkWeeklyReportSeen: () => ({ mutate: vi.fn() }),
  useMarkCelebrationShown: () => ({ mutate: vi.fn() }),
  useUpdateWeeklyReportSettings: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/hooks/useMealPlan", () => ({
  useAddMealPlanItem: () => ({ mutateAsync: h.addToPlan }),
  useRemoveMealPlanItem: () => ({ mutate: vi.fn() }),
}));
vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn(), setOptions: vi.fn() }),
  useRoute: () => ({ params: { id: 41 } }),
}));
vi.mock("@/navigation/navigationRef", () => ({
  navigationRef: { isReady: () => false, navigate: vi.fn() },
}));
vi.mock("@/navigation/openCoachConversation", () => ({
  openCoachWithMessage: vi.fn(),
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));
vi.mock("@/hooks/useHeaderContentInset", () => ({
  useHeaderContentInset: () => 0,
}));
vi.mock("@/hooks/useBottomBudget", () => ({ useBottomBudget: () => 0 }));
vi.mock("@/components/weekly-report/HeadlineCard", () => ({
  HeadlineCard: () => null,
}));
vi.mock("@/components/weekly-report/GoalChart", () => ({
  GoalChart: () => null,
}));
vi.mock("@/components/weekly-report/KitchenRow", () => ({
  KitchenRow: () => null,
}));
vi.mock("@/components/weekly-report/DidYouKnowCard", () => ({
  DidYouKnowCard: () => null,
}));
vi.mock("@/components/weekly-report/WeekNumbers", () => ({
  WeekNumbers: () => null,
}));

beforeEach(() => {
  h.addToPlan.mockReset();
  h.report = {
    id: 41,
    weekStart: "2026-11-15",
    weekEnd: "2026-11-21",
    facts: createMockWeeklyFacts({ quiet: false, daysActive: 4 }),
    content: createMockWeeklyReportContent({
      next: {
        text: "Cook the lentil stew again.",
        recipeId: 5,
        recipeType: "mealPlan",
      },
    }),
    seenAt: null,
    celebrationShownAt: null,
    deliveredVia: null,
  };
});

describe("WeeklyReportScreen — Add to my plan", () => {
  it("a second tap while the first add is in flight adds nothing more", async () => {
    let resolveAdd: (v: { id: number }) => void = () => {};
    h.addToPlan.mockImplementation(() => new Promise((r) => (resolveAdd = r)));
    renderComponent(<WeeklyReportScreen />);
    const button = screen.getByText("Add to my plan");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(h.addToPlan).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveAdd({ id: 9 });
    });
  });

  it("allows another add once the first has finished (control)", async () => {
    h.addToPlan.mockResolvedValue({ id: 9 });
    renderComponent(<WeeklyReportScreen />);
    await act(async () => {
      fireEvent.click(screen.getByText("Add to my plan"));
    });
    await act(async () => {
      fireEvent.click(screen.getByText("Add to my plan"));
    });
    expect(h.addToPlan).toHaveBeenCalledTimes(2);
  });
});
