// @vitest-environment jsdom
//
// Regression coverage for the favourite-heart accessibility fix. The card
// Pressable is accessible by default, so its whole subtree — including the
// nested "remove from favourites" Pressable — collapses into one
// VoiceOver/TalkBack focus stop. The fix exposes the removal toggle as an
// `accessibilityActions` entry on the card instead of restructuring the
// layout.
//
// jsdom cannot model either the collapse itself or the accessibilityActions/
// onAccessibilityAction wiring: the RN mock stringifies `accessibilityActions`
// to `"[object Object]"` and React drops `onAccessibilityAction` outright
// ("Unknown event handler property... It will be ignored" — it doesn't match
// a real DOM event). See
// docs/solutions/conventions/jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md.
// These tests assert only what's provable: the composed card label is
// unchanged by the fix, and the visible "remove from favourites" Pressable's
// own label/role/onPress (the pre-existing touch path) still work. Real
// screen-reader reachability is verified on-device, not here.
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import FavouriteRecipesScreen from "../FavouriteRecipesScreen";
import type { ResolvedFavouriteRecipe } from "@shared/schema";

const { mockUseFavouriteRecipes, mockToggleFavourite } = vi.hoisted(() => ({
  mockUseFavouriteRecipes: vi.fn(),
  mockToggleFavourite: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
}));

vi.mock("@react-navigation/bottom-tabs", () => ({
  useBottomTabBarHeight: () => 0,
}));

vi.mock("@/hooks/useFavouriteRecipes", () => ({
  useFavouriteRecipes: () => mockUseFavouriteRecipes(),
  useToggleFavouriteRecipe: () => ({ mutate: mockToggleFavourite }),
}));

const baseRecipe: ResolvedFavouriteRecipe = {
  recipeId: 42,
  recipeType: "mealPlan",
  title: "Pasta Carbonara",
  description: null,
  imageUrl: null,
  servings: null,
  difficulty: null,
  favouritedAt: "2026-07-24T00:00:00.000Z",
  allergens: null,
};

describe("FavouriteRecipesScreen favourite-heart accessibility", () => {
  it("keeps the card's composed accessibilityLabel unchanged by the fix", () => {
    mockUseFavouriteRecipes.mockReturnValue({
      data: [baseRecipe],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      isRefetching: false,
    });
    renderComponent(<FavouriteRecipesScreen />);
    expect(screen.getByLabelText("Pasta Carbonara")).toBeDefined();
  });

  it("keeps the visible remove-from-favourites button independently reachable by touch, unaffected by the fix", () => {
    mockUseFavouriteRecipes.mockReturnValue({
      data: [baseRecipe],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      isRefetching: false,
    });
    renderComponent(<FavouriteRecipesScreen />);
    const removeButton = screen.getByLabelText(
      "Remove Pasta Carbonara from favourites",
    );
    fireEvent.click(removeButton);
    expect(mockToggleFavourite).toHaveBeenCalledWith({
      recipeId: 42,
      recipeType: "mealPlan",
    });
  });
});

// Coverage for the universal "Contains: <allergen>" label
// (todos/archive/P3-2026-07-24-universal-allergen-label-remaining-surfaces.md).
// The card Pressable is accessible by default, which collapses the nested
// RecipeAllergenLabel's own container into the card's single focus stop, so
// the fix folds the allergen text into the card's own composed label — same
// pattern verified by RecipeBrowserScreen/CarouselRecipeCard.
describe("FavouriteRecipesScreen universal allergen label", () => {
  it("folds the recipe's derived allergens into the card's composed accessibilityLabel", () => {
    mockUseFavouriteRecipes.mockReturnValue({
      data: [
        {
          ...baseRecipe,
          allergens: [{ id: "peanuts", viaDerived: false }],
        },
      ],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      isRefetching: false,
    });
    renderComponent(<FavouriteRecipesScreen />);
    expect(
      screen.getByLabelText("Pasta Carbonara. Contains: Peanuts"),
    ).toBeDefined();
  });

  it("does not add an allergen suffix when allergens is null (never a false 'safe' signal)", () => {
    mockUseFavouriteRecipes.mockReturnValue({
      data: [{ ...baseRecipe, allergens: null }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
      isRefetching: false,
    });
    renderComponent(<FavouriteRecipesScreen />);
    expect(screen.getByLabelText("Pasta Carbonara")).toBeDefined();
  });
});
