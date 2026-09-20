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

  it("passes accessibilityViewIsModal on the sheet's content root (traps VoiceOver focus behind the sheet; jsdom cannot verify the native trap itself, only that the prop is passed). This sheet previously returned a bare Fragment with no single content root — a View was introduced to carry the prop", () => {
    const { container } = renderComponent(
      <QuickAddSheetContent {...defaultProps} />,
    );
    expect(container.querySelector('[aria-modal="true"]')).not.toBeNull();
  });
});
