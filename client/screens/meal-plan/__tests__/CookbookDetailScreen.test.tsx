// @vitest-environment jsdom
//
// Coverage for the universal "Contains: <allergen>" label
// (todos/archive/P3-2026-07-24-universal-allergen-label-remaining-surfaces.md).
// Mirrors FavouriteRecipesScreen.test.tsx's allergen coverage: the card
// Pressable is accessible by default, which collapses the nested
// RecipeAllergenLabel's own container into the card's single VoiceOver/
// TalkBack focus stop, so the fix folds the allergen text into the card's
// own composed accessibilityLabel (same pattern verified by
// RecipeBrowserScreen's UnifiedRecipeCard).
import React from "react";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import CookbookDetailScreen from "../CookbookDetailScreen";
import type { ResolvedCookbookRecipe } from "@shared/schema";

const { mockUseCookbookDetail } = vi.hoisted(() => ({
  mockUseCookbookDetail: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn() }),
  useRoute: () => ({ params: { cookbookId: 1 } }),
}));

vi.mock("@react-navigation/bottom-tabs", () => ({
  useBottomTabBarHeight: () => 0,
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/hooks/useCookbooks", () => ({
  useCookbookDetail: () => mockUseCookbookDetail(),
  useDeleteCookbook: () => ({ mutate: vi.fn() }),
  useRemoveRecipeFromCookbook: () => ({ mutate: vi.fn() }),
}));

const baseRecipe: ResolvedCookbookRecipe = {
  recipeId: 42,
  recipeType: "mealPlan",
  title: "Pasta Carbonara",
  description: null,
  imageUrl: null,
  servings: null,
  difficulty: null,
  addedAt: "2026-07-24T00:00:00.000Z",
  allergens: null,
};

function mockCookbook(recipes: ResolvedCookbookRecipe[]) {
  mockUseCookbookDetail.mockReturnValue({
    data: {
      id: 1,
      userId: "user-1",
      name: "My Cookbook",
      description: null,
      coverImageUrl: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      recipes,
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
}

describe("CookbookDetailScreen universal allergen label", () => {
  it("folds the recipe's derived allergens into the card's composed accessibilityLabel", () => {
    mockCookbook([
      { ...baseRecipe, allergens: [{ id: "peanuts", viaDerived: false }] },
    ]);
    renderComponent(<CookbookDetailScreen />);
    expect(
      screen.getByLabelText("Pasta Carbonara. Contains Peanuts"),
    ).toBeDefined();
  });

  it("does not add an allergen suffix when allergens is null (never a false 'safe' signal)", () => {
    mockCookbook([{ ...baseRecipe, allergens: null }]);
    renderComponent(<CookbookDetailScreen />);
    expect(screen.getByLabelText("Pasta Carbonara")).toBeDefined();
  });
});
