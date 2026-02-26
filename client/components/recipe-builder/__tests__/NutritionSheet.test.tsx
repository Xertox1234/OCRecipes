// @vitest-environment jsdom
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { NutritionSheet } from "../NutritionSheet";
import type { NutritionData } from "@/hooks/useRecipeForm";

describe("NutritionSheet", () => {
  const defaultData: NutritionData = {
    calories: "350",
    protein: "25",
    carbs: "40",
    fat: "12",
  };
  const onChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders all 4 nutrition field labels", () => {
    renderComponent(<NutritionSheet data={defaultData} onChange={onChange} />);
    expect(screen.getByText("Calories")).toBeDefined();
    expect(screen.getByText("Protein")).toBeDefined();
    expect(screen.getByText("Carbs")).toBeDefined();
    expect(screen.getByText("Fat")).toBeDefined();
  });

  it("renders 4 input fields", () => {
    const { container } = renderComponent(
      <NutritionSheet data={defaultData} onChange={onChange} />,
    );
    const inputs = container.querySelectorAll("input");
    expect(inputs.length).toBe(4);
  });

  it("renders unit labels", () => {
    renderComponent(<NutritionSheet data={defaultData} onChange={onChange} />);
    expect(screen.getByText("kcal")).toBeDefined();
    // "g" appears 3 times (protein, carbs, fat)
    expect(screen.getAllByText("g").length).toBe(3);
  });
});
