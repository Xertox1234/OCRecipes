// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { IngredientsSheet } from "../IngredientsSheet";
import type { IngredientRow } from "@/hooks/useRecipeForm";

describe("IngredientsSheet", () => {
  const twoIngredients: IngredientRow[] = [
    { key: "1", text: "2 cups flour" },
    { key: "2", text: "1 tsp salt" },
  ];

  const callbacks = {
    onAdd: vi.fn(),
    onRemove: vi.fn(),
    onUpdate: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders ingredient input fields", () => {
    const { container } = renderComponent(
      <IngredientsSheet data={twoIngredients} {...callbacks} />,
    );
    const inputs = container.querySelectorAll("input");
    expect(inputs.length).toBe(2);
  });

  it("renders Add ingredient button", () => {
    renderComponent(<IngredientsSheet data={twoIngredients} {...callbacks} />);
    expect(screen.getByText("Add ingredient")).toBeDefined();
  });

  it("calls onAdd when Add ingredient is pressed", () => {
    renderComponent(<IngredientsSheet data={twoIngredients} {...callbacks} />);
    fireEvent.click(screen.getByLabelText("Add ingredient"));
    expect(callbacks.onAdd).toHaveBeenCalledOnce();
  });

  it("shows delete buttons when more than 1 ingredient", () => {
    renderComponent(<IngredientsSheet data={twoIngredients} {...callbacks} />);
    // Delete icon is "x", accessible via labels
    expect(
      screen.getByLabelText("Remove ingredient 2 cups flour"),
    ).toBeDefined();
    expect(screen.getByLabelText("Remove ingredient 1 tsp salt")).toBeDefined();
  });

  it("hides delete button for single ingredient", () => {
    renderComponent(
      <IngredientsSheet data={[{ key: "1", text: "flour" }]} {...callbacks} />,
    );
    expect(screen.queryByLabelText(/Remove ingredient/)).toBeNull();
  });
});
