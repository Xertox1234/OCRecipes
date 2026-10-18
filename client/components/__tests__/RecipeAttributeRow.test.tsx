// @vitest-environment jsdom
import React from "react";
import { describe, it, expect } from "vitest";
// Repo convention: renderComponent wraps RTL-for-web + QueryClient (jsdom).
import { renderComponent } from "../../../test/utils/render-component";
import { RecipeAttributeRow } from "@/components/RecipeAttributeRow";

describe("RecipeAttributeRow", () => {
  it("shows the checked diet chip, then the separate Contains group", () => {
    const { getByText, getByLabelText, container } = renderComponent(
      <RecipeAttributeRow
        facts={{
          dietTags: ["vegan"],
          allergens: [{ id: "soy", viaDerived: false }],
          dietConflicts: [],
          totalTimeMinutes: null,
        }}
      />,
    );

    expect(getByText("Vegan")).toBeTruthy();
    expect(getByLabelText("Vegan")).toBeTruthy();
    expect(getByText("Contains:")).toBeTruthy();
    expect(getByText("Soy")).toBeTruthy();
    expect(container.querySelector('[data-icon="sprout"]')).toBeTruthy();
    expect(container.querySelector('[data-icon="soy-sauce"]')).toBeTruthy();
  });

  it("hides the diet chip while diet conflicts are unchecked, but keeps Contains", () => {
    const { queryByText, getByText } = renderComponent(
      <RecipeAttributeRow
        facts={{
          dietTags: ["vegan"],
          allergens: [{ id: "soy", viaDerived: false }],
          dietConflicts: null,
          totalTimeMinutes: null,
        }}
      />,
    );

    expect(queryByText("Vegan")).toBeNull();
    expect(getByText("Contains:")).toBeTruthy();
  });

  it("renders nothing when there is nothing to show", () => {
    const { container } = renderComponent(
      <RecipeAttributeRow
        facts={{
          dietTags: [],
          allergens: [],
          dietConflicts: [],
          totalTimeMinutes: null,
        }}
      />,
    );

    expect(container.firstChild).toBeNull();
  });
});
