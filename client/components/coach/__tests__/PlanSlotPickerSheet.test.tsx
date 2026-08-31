// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { PlanSlotPickerSheet } from "../PlanSlotPickerSheet";

const onConfirm = vi.fn();
const onDismiss = vi.fn();

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
});
