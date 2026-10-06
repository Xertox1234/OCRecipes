// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../../test/utils/render-component";
import { QuickAddSheetContent } from "../QuickAddSheet";

const {
  mockImpact,
  mockNotification,
  mockToastSuccess,
  mockToastError,
  mockAddItem,
} = vi.hoisted(() => ({
  mockImpact: vi.fn(),
  mockNotification: vi.fn(),
  mockToastSuccess: vi.fn(),
  mockToastError: vi.fn(),
  mockAddItem: vi.fn(),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: mockImpact,
    selection: vi.fn(),
    notification: mockNotification,
  }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: mockToastError,
    info: vi.fn(),
  }),
}));

vi.mock("@/hooks/useMealPlanRecipes", () => ({
  useUnifiedRecipes: () => ({
    data: {
      personal: [{ id: 5, title: "Oats", caloriesPerServing: null }],
      frequent: [],
      community: [],
    },
    isLoading: false,
    isError: false,
  }),
}));

vi.mock("@/hooks/useMealPlan", () => ({
  useAddMealPlanItem: () => ({
    mutateAsync: mockAddItem,
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

  it("wraps the header, the search box, AND the results list's footer (all 3 of the sheet's own children, the last two being LATER siblings) in the SAME accessibilityViewIsModal ancestor — traps VoiceOver focus behind the sheet; jsdom cannot verify the native trap itself, only that the prop is passed. This sheet previously returned a bare Fragment of 3 siblings with no single content root; accessibilityViewIsModal only suppresses EARLIER siblings on iOS (docs/solutions/logic-errors/accessibilityviewismodal-later-siblings-stay-accessible-2026-08-17.md), so a regression that re-flagged only the header — or that closed the flagged View right after the search box — leaving the results list/footer as an unflagged later sibling, must fail this test", () => {
    renderComponent(<QuickAddSheetContent {...defaultProps} />);
    const headerModalAncestor = screen
      .getByText("Add to Breakfast")
      .closest('[aria-modal="true"]');
    const searchModalAncestor = screen
      .getByLabelText("Search recipes")
      .closest('[aria-modal="true"]');
    const footerModalAncestor = screen
      .getByLabelText("Import a recipe")
      .closest('[aria-modal="true"]');
    expect(headerModalAncestor).not.toBeNull();
    expect(searchModalAncestor).not.toBeNull();
    expect(footerModalAncestor).not.toBeNull();
    expect(searchModalAncestor).toBe(headerModalAncestor);
    expect(footerModalAncestor).toBe(headerModalAncestor);
  });

  // The sheet closes on add, so the confirmation is a toast (it fires its own
  // Success haptic); the light tap at press stays as the acknowledgement.
  describe("add feedback", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("a successful add toasts the day and meal, with no extra Success haptic", async () => {
      mockAddItem.mockResolvedValue({ id: 1 });
      renderComponent(
        <QuickAddSheetContent {...defaultProps} plannedDate="2026-09-02" />,
      );

      fireEvent.click(screen.getByLabelText("Add Oats to breakfast"));

      await waitFor(() => {
        expect(defaultProps.onDismiss).toHaveBeenCalledOnce();
      });
      expect(mockToastSuccess).toHaveBeenCalledExactlyOnceWith(
        "Added to Wednesday Breakfast",
      );
      expect(mockNotification).not.toHaveBeenCalled();
      expect(mockImpact).toHaveBeenCalledWith(
        Haptics.ImpactFeedbackStyle.Light,
      );
    });

    it("a failed add shows the error toast and no success toast", async () => {
      mockAddItem.mockRejectedValue(new Error("500"));
      renderComponent(<QuickAddSheetContent {...defaultProps} />);

      fireEvent.click(screen.getByLabelText("Add Oats to breakfast"));

      await waitFor(() => {
        expect(mockToastError).toHaveBeenCalledOnce();
      });
      expect(mockToastSuccess).not.toHaveBeenCalled();
      expect(defaultProps.onDismiss).not.toHaveBeenCalled();
    });
  });
});
