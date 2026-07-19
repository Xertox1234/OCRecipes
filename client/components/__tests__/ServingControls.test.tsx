// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { ServingControls } from "../ServingControls";

const baseProps = {
  servingOptions: [
    { label: "1 cup", grams: 100 },
    { label: "1 bowl", grams: 200 },
  ],
  servingSizeGrams: 100,
  setServingSizeGrams: vi.fn(),
  servingQuantity: 1,
  setServingQuantity: vi.fn(),
  showCustomInput: false,
  setShowCustomInput: vi.fn(),
  customGramsInput: "",
  setCustomGramsInput: vi.fn(),
  recalculateNutrition: vi.fn(),
};

describe("ServingControls — serving size radio semantics", () => {
  it("wraps the serving chip row in a radiogroup", () => {
    renderComponent(<ServingControls {...baseProps} />);
    expect(screen.getByRole("radiogroup")).toBeTruthy();
  });

  it("exposes each serving option and the Custom chip as a radio with the correct selected state", () => {
    renderComponent(<ServingControls {...baseProps} />);

    // 2 serving options + the Custom chip = 3 mutually-exclusive radios.
    expect(screen.getAllByRole("radio")).toHaveLength(3);

    const activeChip = screen.getByLabelText("Set serving to 1 cup");
    expect(activeChip.getAttribute("role")).toBe("radio");
    expect(activeChip.getAttribute("aria-selected")).toBe("true");

    const inactiveChip = screen.getByLabelText("Set serving to 1 bowl");
    expect(inactiveChip.getAttribute("role")).toBe("radio");
    expect(inactiveChip.getAttribute("aria-selected")).toBe("false");

    const customChip = screen.getByLabelText("Enter custom serving size");
    expect(customChip.getAttribute("role")).toBe("radio");
    expect(customChip.getAttribute("aria-selected")).toBe("false");
  });

  it("marks the Custom chip selected instead of a serving option when custom input is active", () => {
    renderComponent(
      <ServingControls {...baseProps} showCustomInput customGramsInput="150" />,
    );

    expect(
      screen
        .getByLabelText("Enter custom serving size")
        .getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen
        .getByLabelText("Set serving to 1 cup")
        .getAttribute("aria-selected"),
    ).toBe("false");
  });
});
