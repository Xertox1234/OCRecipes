// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../../test/utils/render-component";
import IngredientsStep from "../IngredientsStep";
import {
  countFilledIngredients,
  hasIngredientText,
  shouldShowIngredientDelete,
} from "../ingredients-step-utils";

const { mockImpact, mockNotification, mockSelection } = vi.hoisted(() => ({
  mockImpact: vi.fn(),
  mockNotification: vi.fn(),
  mockSelection: vi.fn(),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: mockImpact,
    notification: mockNotification,
    selection: mockSelection,
    disabled: false,
  }),
}));

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe("shouldShowIngredientDelete", () => {
  it("returns false when there is one row (can't remove the only row)", () => {
    expect(shouldShowIngredientDelete(1)).toBe(false);
  });

  it("returns true when there are two rows", () => {
    expect(shouldShowIngredientDelete(2)).toBe(true);
  });

  it("returns true for many rows", () => {
    expect(shouldShowIngredientDelete(10)).toBe(true);
  });

  it("returns false for zero rows (defensive — UI should never hit this)", () => {
    expect(shouldShowIngredientDelete(0)).toBe(false);
  });
});

describe("hasIngredientText", () => {
  it("returns false for empty string", () => {
    expect(hasIngredientText({ text: "" })).toBe(false);
  });

  it("returns false for whitespace-only text", () => {
    expect(hasIngredientText({ text: "   " })).toBe(false);
  });

  it("returns true for non-empty text", () => {
    expect(hasIngredientText({ text: "2 cups flour" })).toBe(true);
  });
});

describe("countFilledIngredients", () => {
  it("counts only rows with non-whitespace text", () => {
    expect(
      countFilledIngredients([
        { text: "2 cups flour" },
        { text: "" },
        { text: "  " },
        { text: "1 cup milk" },
      ]),
    ).toBe(2);
  });

  it("returns 0 when all rows are empty", () => {
    expect(countFilledIngredients([{ text: "" }, { text: "   " }])).toBe(0);
  });
});

// ── Rendered IngredientsStep ─────────────────────────────────────────────────

function row(key: string, text: string) {
  return { key, text };
}

describe("IngredientsStep — render", () => {
  it("hides the delete button when there is only one row", () => {
    renderComponent(
      <IngredientsStep
        ingredients={[row("ing_1", "")]}
        addIngredient={vi.fn()}
        removeIngredient={vi.fn()}
        updateIngredient={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("Remove ingredient")).toBeNull();
  });

  it("shows a delete button for every row when there are 2+ rows", () => {
    renderComponent(
      <IngredientsStep
        ingredients={[row("ing_1", "flour"), row("ing_2", "milk")]}
        addIngredient={vi.fn()}
        removeIngredient={vi.fn()}
        updateIngredient={vi.fn()}
      />,
    );
    expect(screen.getAllByLabelText("Remove ingredient")).toHaveLength(2);
  });

  it("calls addIngredient when the Add row is pressed", () => {
    const addIngredient = vi.fn();
    renderComponent(
      <IngredientsStep
        ingredients={[row("ing_1", "")]}
        addIngredient={addIngredient}
        removeIngredient={vi.fn()}
        updateIngredient={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Add ingredient"));
    expect(addIngredient).toHaveBeenCalledTimes(1);
  });

  it("triggers haptic feedback via the centralized useHaptics hook when Add ingredient is pressed", () => {
    renderComponent(
      <IngredientsStep
        ingredients={[row("ing_1", "")]}
        addIngredient={vi.fn()}
        removeIngredient={vi.fn()}
        updateIngredient={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText("Add ingredient"));
    expect(mockImpact).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it("calls removeIngredient with the row key when X is pressed", () => {
    const removeIngredient = vi.fn();
    renderComponent(
      <IngredientsStep
        ingredients={[row("ing_1", "flour"), row("ing_2", "milk")]}
        addIngredient={vi.fn()}
        removeIngredient={removeIngredient}
        updateIngredient={vi.fn()}
      />,
    );
    const deleteButtons = screen.getAllByLabelText("Remove ingredient");
    fireEvent.click(deleteButtons[1]);
    expect(removeIngredient).toHaveBeenCalledWith("ing_2");
  });

  it("triggers haptic feedback via the centralized useHaptics hook when an ingredient is removed", () => {
    renderComponent(
      <IngredientsStep
        ingredients={[row("ing_1", "flour"), row("ing_2", "milk")]}
        addIngredient={vi.fn()}
        removeIngredient={vi.fn()}
        updateIngredient={vi.fn()}
      />,
    );
    const deleteButtons = screen.getAllByLabelText("Remove ingredient");
    fireEvent.click(deleteButtons[1]);
    expect(mockImpact).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it("calls updateIngredient when the user types in a row", () => {
    const updateIngredient = vi.fn();
    renderComponent(
      <IngredientsStep
        ingredients={[row("ing_1", "")]}
        addIngredient={vi.fn()}
        removeIngredient={vi.fn()}
        updateIngredient={updateIngredient}
      />,
    );
    const inputs = screen.getAllByLabelText("Ingredient");
    fireEvent.change(inputs[0], { target: { value: "2 cups flour" } });
    expect(updateIngredient).toHaveBeenCalledWith("ing_1", "2 cups flour");
  });
});
