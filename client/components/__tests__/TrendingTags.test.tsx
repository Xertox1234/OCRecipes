// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { TrendingTags } from "../TrendingTags";

const ALL_TAGS = [
  "Breakfast",
  "Lunch",
  "Dinner",
  "Salads",
  "Pasta",
  "Smoothies",
  "Vegan",
  "Quick Meals",
];

describe("TrendingTags", () => {
  it("renders the section title", () => {
    renderComponent(<TrendingTags onTagPress={() => {}} />);
    expect(screen.getByText("Trending Search")).toBeDefined();
  });

  it("renders all 8 tags", () => {
    renderComponent(<TrendingTags onTagPress={() => {}} />);
    for (const tag of ALL_TAGS) {
      expect(screen.getByText(tag)).toBeDefined();
    }
  });

  it("calls onTagPress with the tag name when a tag is pressed", () => {
    const onTagPress = vi.fn();
    renderComponent(<TrendingTags onTagPress={onTagPress} />);
    fireEvent.click(screen.getByText("Pasta"));
    expect(onTagPress).toHaveBeenCalledWith("Pasta");
  });

  it("has accessible labels for each tag", () => {
    renderComponent(<TrendingTags onTagPress={() => {}} />);
    expect(screen.getByLabelText("Search for Breakfast recipes")).toBeDefined();
  });
});
