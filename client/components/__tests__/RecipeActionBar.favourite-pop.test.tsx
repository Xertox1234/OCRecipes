// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { RecipeActionBar } from "../RecipeActionBar";

const { mockTriggerPop, mockImpact, mockToggle } = vi.hoisted(() => ({
  mockTriggerPop: vi.fn(),
  mockImpact: vi.fn(),
  mockToggle: vi.fn(),
}));

// The pop's own trigger fires the Success haptic, so a favourite should be
// exactly one buzz: the pop. Unfavouriting keeps the plain impact tap.
vi.mock("@/hooks/useSuccessAnimation", () => ({
  useSuccessPop: () => ({
    trigger: mockTriggerPop,
    animatedStyle: {},
    scale: { value: 1 },
  }),
}));
vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: mockImpact,
    selection: vi.fn(),
    notification: vi.fn(),
  }),
}));
vi.mock("@/hooks/useFavouriteRecipes", () => ({
  useToggleFavouriteRecipe: () => ({ mutate: mockToggle }),
  useShareRecipe: () => ({ share: vi.fn() }),
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RecipeActionBar — favourite heart pop", () => {
  it("pops the heart (one buzz) when favouriting", () => {
    renderComponent(
      <RecipeActionBar
        recipeId={7}
        recipeType="community"
        isFavourited={false}
        onSaveToCookbook={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("Add to favourites"));

    expect(mockToggle).toHaveBeenCalledWith({
      recipeId: 7,
      recipeType: "community",
    });
    expect(mockTriggerPop).toHaveBeenCalledTimes(1);
    expect(mockImpact).not.toHaveBeenCalled();
  });

  it("taps without a pop when unfavouriting", () => {
    renderComponent(
      <RecipeActionBar
        recipeId={7}
        recipeType="community"
        isFavourited
        onSaveToCookbook={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByLabelText("Remove from favourites"));

    expect(mockToggle).toHaveBeenCalledTimes(1);
    expect(mockTriggerPop).not.toHaveBeenCalled();
    expect(mockImpact).toHaveBeenCalledTimes(1);
  });
});
