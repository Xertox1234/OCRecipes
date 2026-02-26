// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { TagsCuisineSheet } from "../TagsCuisineSheet";
import type { TagsData } from "@/hooks/useRecipeForm";

describe("TagsCuisineSheet", () => {
  const defaultData: TagsData = {
    cuisine: "Italian",
    dietTags: [],
  };
  const onChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders cuisine input", () => {
    const { container } = renderComponent(
      <TagsCuisineSheet data={defaultData} onChange={onChange} />,
    );
    const inputs = container.querySelectorAll("input");
    expect(inputs.length).toBeGreaterThanOrEqual(1);
  });

  it("renders Cuisine label", () => {
    renderComponent(
      <TagsCuisineSheet data={defaultData} onChange={onChange} />,
    );
    expect(screen.getByText("Cuisine")).toBeDefined();
  });

  it("renders all diet tag options", () => {
    renderComponent(
      <TagsCuisineSheet data={defaultData} onChange={onChange} />,
    );
    const expectedTags = [
      "Vegetarian",
      "Vegan",
      "Gluten Free",
      "Dairy Free",
      "Keto",
      "Paleo",
      "Low Carb",
      "High Protein",
    ];
    for (const tag of expectedTags) {
      expect(screen.getByText(tag)).toBeDefined();
    }
  });

  it("calls onChange when a diet tag is toggled", () => {
    renderComponent(
      <TagsCuisineSheet data={defaultData} onChange={onChange} />,
    );
    fireEvent.click(screen.getByText("Vegan"));
    expect(onChange).toHaveBeenCalledWith({
      ...defaultData,
      dietTags: ["Vegan"],
    });
  });

  it("removes tag when already selected", () => {
    renderComponent(
      <TagsCuisineSheet
        data={{ ...defaultData, dietTags: ["Keto"] }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("Keto"));
    expect(onChange).toHaveBeenCalledWith({
      ...defaultData,
      dietTags: [],
    });
  });
});
