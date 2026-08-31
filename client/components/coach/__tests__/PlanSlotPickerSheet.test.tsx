// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { PlanSlotPickerSheet } from "../PlanSlotPickerSheet";
import { buildPlanSlotDays } from "../plan-slot-picker-utils";

const onConfirm = vi.fn();
const onDismiss = vi.fn();

// vi.hoisted so the same fn instance backs both the mock factory (which
// vi.mock hoists above these imports) and the assertions below — mirrors
// client/components/recipe-chat/__tests__/RecipeCard.test.tsx.
const { mockImpact } = vi.hoisted(() => ({
  mockImpact: vi.fn(),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: mockImpact,
    notification: vi.fn(),
    selection: vi.fn(),
  }),
}));

const baseProps = {
  visible: true,
  recipeTitle: "Lemon Chicken",
  datesWithItems: new Set<string>(),
  isSubmitting: false,
  onConfirm,
  onDismiss,
};

describe("PlanSlotPickerSheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  it("offers seven days and all four meal types", () => {
    renderComponent(<PlanSlotPickerSheet {...baseProps} />);
    expect(screen.getAllByRole("button", { name: /day-slot/i })).toHaveLength(
      7,
    );
    for (const label of ["Breakfast", "Lunch", "Dinner", "Snack"]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it("confirms with the selected date and meal type", () => {
    renderComponent(<PlanSlotPickerSheet {...baseProps} />);
    fireEvent.click(screen.getAllByRole("button", { name: /day-slot/i })[2]);
    fireEvent.click(screen.getByText("Dinner"));
    fireEvent.click(screen.getByRole("button", { name: /add to plan/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const [plannedDate, mealType] = onConfirm.mock.calls[0];
    expect(plannedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(mealType).toBe("dinner");
  });

  it("does not confirm until a meal type is chosen", () => {
    renderComponent(<PlanSlotPickerSheet {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /add to plan/i }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders nothing when not visible", () => {
    renderComponent(<PlanSlotPickerSheet {...baseProps} visible={false} />);
    expect(screen.queryByText("Lemon Chicken")).toBeNull();
  });

  it("resets the selection when the sheet closes and reopens", () => {
    // The Modal mock only nulls its CHILDREN when visible=false — the
    // PlanSlotPickerSheet wrapper itself never unmounts, so its useState
    // survives the round trip unless the component explicitly clears it on
    // the false->true transition. A silent stale selection would let a
    // reopened sheet fire onConfirm with the PREVIOUS recipe's meal choice
    // before the user has chosen anything for the new one.
    const { rerender } = renderComponent(
      <PlanSlotPickerSheet {...baseProps} />,
    );
    fireEvent.click(screen.getAllByRole("button", { name: /day-slot/i })[2]);
    fireEvent.click(screen.getByText("Dinner"));
    const dinnerChip = screen.getByRole("button", { name: /^Dinner$/i });
    expect(dinnerChip.getAttribute("aria-selected")).toBe("true");

    rerender(<PlanSlotPickerSheet {...baseProps} visible={false} />);
    rerender(<PlanSlotPickerSheet {...baseProps} visible={true} />);

    const dinnerChipAfterReopen = screen.getByRole("button", {
      name: /^Dinner$/i,
    });
    expect(dinnerChipAfterReopen.getAttribute("aria-selected")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /add to plan/i }));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("hides the has-items dot on the selected day but shows it on an unselected day with items — regression for the accentSolid/link color collision", () => {
    // Review finding: theme.link and theme.accentSolid are the identical hex
    // in light mode, so a dot rendered unconditionally on `hasItems` (with no
    // `!selected` guard) visually vanishes into the selected chip's own fill
    // — exactly on today (days[0], the default selection), the day most
    // likely to already have plan items.
    const days = buildPlanSlotDays(new Date());
    const datesWithItems = new Set([days[0].iso, days[2].iso]);
    renderComponent(
      <PlanSlotPickerSheet {...baseProps} datesWithItems={datesWithItems} />,
    );

    // days[0] is selected by default AND has items — dot must be hidden.
    expect(screen.queryByTestId(`plan-slot-dot-${days[0].iso}`)).toBeNull();
    // days[2] is unselected and has items — dot must be visible.
    expect(screen.queryByTestId(`plan-slot-dot-${days[2].iso}`)).not.toBeNull();

    // Selecting days[2] flips which of the two dots is suppressed.
    fireEvent.click(screen.getAllByRole("button", { name: /day-slot/i })[2]);
    expect(screen.queryByTestId(`plan-slot-dot-${days[2].iso}`)).toBeNull();
    expect(screen.queryByTestId(`plan-slot-dot-${days[0].iso}`)).not.toBeNull();
  });

  it("fires haptic feedback via useHaptics on day-chip select, meal-chip select, and confirm", () => {
    renderComponent(<PlanSlotPickerSheet {...baseProps} />);

    fireEvent.click(screen.getAllByRole("button", { name: /day-slot/i })[2]);
    expect(mockImpact).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText("Dinner"));
    expect(mockImpact).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole("button", { name: /add to plan/i }));
    expect(mockImpact).toHaveBeenCalledTimes(3);
  });

  it("does not fire confirm's haptic when the button is disabled (no meal chosen)", () => {
    renderComponent(<PlanSlotPickerSheet {...baseProps} />);
    fireEvent.click(screen.getByRole("button", { name: /add to plan/i }));
    expect(mockImpact).not.toHaveBeenCalled();
  });

  it("gives the disabled confirm button an accessibilityHint naming the missing meal type", () => {
    renderComponent(<PlanSlotPickerSheet {...baseProps} />);
    const confirmButton = screen.getByRole("button", {
      name: /add to plan/i,
    });
    expect(confirmButton.getAttribute("aria-hint")).toMatch(/meal type/i);
  });

  it("does not claim a meal type is missing once one is chosen, even while submitting", () => {
    const { rerender } = renderComponent(
      <PlanSlotPickerSheet {...baseProps} />,
    );
    fireEvent.click(screen.getByText("Dinner"));
    const confirmButton = screen.getByRole("button", {
      name: /add to plan/i,
    });
    // Enabled and idle — no hint needed, and definitely not "missing" language.
    expect(confirmButton.getAttribute("aria-hint") ?? "").not.toMatch(
      /meal type/i,
    );

    // `selectedMeal` is component-internal state and survives this rerender
    // (visible stays true throughout — no false->true reset edge fires), so
    // Dinner is still selected here without re-clicking it.
    rerender(<PlanSlotPickerSheet {...baseProps} isSubmitting={true} />);
    const confirmButtonSubmitting = screen.getByRole("button", {
      name: /add to plan/i,
    });
    expect(confirmButtonSubmitting.getAttribute("aria-hint") ?? "").not.toMatch(
      /meal type/i,
    );
  });
});
