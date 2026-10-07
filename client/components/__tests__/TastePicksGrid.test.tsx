// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../test/utils/render-component";
import { TastePicksGrid } from "../TastePicksGrid";
import type { RecipeCandidate } from "@shared/types/taste-picks";

const candidates = [
  {
    id: 1,
    title: "Pad Thai",
    imageUrl: "https://x/1.jpg",
    cuisineOrigin: "Thai",
  },
  { id: 2, title: "Tacos", imageUrl: "https://x/2.jpg", cuisineOrigin: null },
] as unknown as RecipeCandidate[];

describe("TastePicksGrid", () => {
  it("picking a recipe ticks once and toggles it", () => {
    const onToggle = vi.fn();
    renderComponent(
      <TastePicksGrid
        candidates={candidates}
        selectedIds={new Set([2])}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Pad Thai, Thai cuisine" }),
    );
    expect(onToggle).toHaveBeenCalledWith(1);
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole("checkbox", { name: "Tacos" })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });
});
