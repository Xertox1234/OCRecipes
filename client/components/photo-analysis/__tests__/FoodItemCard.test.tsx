// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";

import { renderComponent } from "../../../../test/utils/render-component";
import { FoodItemCard } from "../FoodItemCard";

const food = {
  name: "Rice",
  quantity: "1 cup",
  confidence: 0.9,
  needsClarification: false,
  nutrition: null,
};

const renderCard = (isSelected: boolean) =>
  renderComponent(
    <FoodItemCard
      food={food}
      index={0}
      onEdit={vi.fn()}
      reducedMotion
      isSelected={isSelected}
      onToggleSelect={vi.fn()}
      showNutrition={false}
      showCheckbox
      showPrepPicker={false}
    />,
  );

// Accessibility audit 2026-11-21 L10: every card's edit button said "Edit
// food item", and the checkbox label flipped Select/Unselect while also
// reporting its checked state (the state was said twice).
describe("FoodItemCard labels", () => {
  it("names the food on the edit button", () => {
    renderCard(false);
    expect(screen.getByRole("button", { name: "Edit Rice" })).toBeTruthy();
  });

  it("keeps a fixed checkbox label; the state carries checked", () => {
    renderCard(true);
    const box = screen.getByRole("checkbox", { name: "Rice" });
    expect(box.getAttribute("aria-checked")).toBe("true");
  });
});
