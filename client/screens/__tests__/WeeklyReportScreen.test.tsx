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
  toastSuccess: vi.fn(),
  confirmPick: vi.fn(async () => ({
    proceed: true,
    note: null as string | null,
  })),
}));

vi.mock("@/hooks/useConfirmPlanPick", () => ({
  useConfirmPlanPick: () => h.confirmPick,
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
  useToast: () => ({ success: h.toastSuccess, error: vi.fn(), info: vi.fn() }),
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
  h.toastSuccess.mockReset();
  h.confirmPick.mockClear();
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
    // The allergen check runs first, so the add starts a tick later.
    await act(async () => {});
    expect(h.confirmPick).toHaveBeenCalledTimes(1);
    expect(h.addToPlan).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveAdd({ id: 9 });
    });
  });

  // Owner decision 2026-11-20: the allergen check runs before the add.
  it("checks the recipe's allergens for tomorrow's dinner before adding", async () => {
    h.addToPlan.mockResolvedValue({ id: 9 });
    renderComponent(<WeeklyReportScreen />);
    await act(async () => {
      fireEvent.click(screen.getByText("Add to my plan"));
    });
    expect(h.confirmPick).toHaveBeenCalledWith({
      slot: { plannedDate: expect.any(String), mealType: "dinner" },
      meal: { recipeId: expect.any(Number) },
    });
    const [{ slot }] = h.confirmPick.mock.calls[0] as unknown as [
      { slot: { plannedDate: string } },
    ];
    expect(h.addToPlan).toHaveBeenCalledWith(
      expect.objectContaining({ plannedDate: slot.plannedDate }),
    );
  });

  it("adds nothing when the user cancels at the allergy warning, and can try again", async () => {
    h.confirmPick.mockResolvedValueOnce({ proceed: false, note: null });
    h.addToPlan.mockResolvedValue({ id: 9 });
    renderComponent(<WeeklyReportScreen />);
    await act(async () => {
      fireEvent.click(screen.getByText("Add to my plan"));
    });
    expect(h.addToPlan).not.toHaveBeenCalled();
    expect(h.toastSuccess).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByText("Add to my plan"));
    });
    expect(h.addToPlan).toHaveBeenCalledTimes(1);
  });

  it("says in the success toast when allergens could not be checked", async () => {
    h.confirmPick.mockResolvedValueOnce({
      proceed: true,
      note: "Allergens not checked",
    });
    h.addToPlan.mockResolvedValue({ id: 9 });
    renderComponent(<WeeklyReportScreen />);
    await act(async () => {
      fireEvent.click(screen.getByText("Add to my plan"));
    });
    expect(h.toastSuccess).toHaveBeenCalledWith(
      expect.stringMatching(/\. Allergens not checked$/),
      expect.anything(),
    );
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
