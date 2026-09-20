// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { QuickAddSheetContent } from "../QuickAddSheet";

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    selection: vi.fn(),
    notification: vi.fn(),
  }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/hooks/useMealPlanRecipes", () => ({
  useUnifiedRecipes: () => ({
    data: { personal: [], frequent: [], community: [] },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("@/hooks/useMealPlan", () => ({
  useAddMealPlanItem: () => ({
    mutateAsync: vi.fn(),
  }),
}));

describe("QuickAddSheet", () => {
  const defaultProps = {
    mealType: "breakfast" as const,
    plannedDate: "2025-06-01",
    onDismiss: vi.fn(),
    onNavigateCreate: vi.fn(),
    onOpenImportSheet: vi.fn(),
  };

  it("renders the header with meal label", () => {
    renderComponent(<QuickAddSheetContent {...defaultProps} />);
    expect(screen.getByText("Add to Breakfast")).toBeDefined();
  });

  it("wraps the header AND the search box (a later sibling) in the SAME accessibilityViewIsModal ancestor — traps VoiceOver focus behind the sheet; jsdom cannot verify the native trap itself, only that the prop is passed. This sheet previously returned a bare Fragment of 3 siblings with no single content root; accessibilityViewIsModal only suppresses EARLIER siblings on iOS (docs/solutions/logic-errors/accessibilityviewismodal-later-siblings-stay-accessible-2026-08-17.md), so a regression that re-flagged only the header — leaving the search box and results list as unflagged later siblings — must fail this test", () => {
    renderComponent(<QuickAddSheetContent {...defaultProps} />);
    const headerModalAncestor = screen
      .getByText("Add to Breakfast")
      .closest('[aria-modal="true"]');
    const searchModalAncestor = screen
      .getByLabelText("Search recipes")
      .closest('[aria-modal="true"]');
    expect(headerModalAncestor).not.toBeNull();
    expect(searchModalAncestor).not.toBeNull();
    expect(searchModalAncestor).toBe(headerModalAncestor);
  });
});
