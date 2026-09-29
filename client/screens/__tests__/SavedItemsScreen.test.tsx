// @vitest-environment jsdom
// A Saved Items row linked to a real recipe (a catalog or chat Save — user
// ruling 2026-09-29) opens that recipe; a snapshot item (a suggestion) has no
// recipe to open and keeps today's behaviour.
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import SavedItemsScreen from "../SavedItemsScreen";
import type { SavedItem } from "@shared/schema";

const { mockNavigate, mockUseSavedItems } = vi.hoisted(() => ({
  mockNavigate: vi.fn(),
  mockUseSavedItems: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate, setOptions: vi.fn() }),
  useIsFocused: () => true,
}));
vi.mock("@/hooks/useHeaderContentInset", () => ({
  useHeaderContentInset: () => 0,
}));
vi.mock("@/hooks/useSavedItems", () => ({
  useSavedItems: () => mockUseSavedItems(),
  useSavedItemCount: () => ({ data: { count: 2 }, isError: false }),
  useDeleteSavedItem: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
}));
vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({
    isPremium: false,
    features: { maxSavedItems: 6 },
  }),
}));

const item = (over: Partial<SavedItem>): SavedItem => ({
  id: 1,
  userId: "1",
  type: "recipe",
  title: "Lemon Pasta",
  description: null,
  difficulty: null,
  timeEstimate: null,
  instructions: null,
  sourceItemId: null,
  sourceProductName: null,
  recipeId: null,
  recipeType: null,
  createdAt: new Date("2026-09-29T00:00:00Z"),
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

const listOf = (items: SavedItem[]) =>
  mockUseSavedItems.mockReturnValue({
    data: items,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    isRefetching: false,
  });

describe("SavedItemsScreen — linked recipes", () => {
  it("tapping a saved Spoonacular recipe opens it as the user's recipe", () => {
    listOf([item({ id: 1, recipeId: 77, recipeType: "mealPlan" })]);

    renderComponent(<SavedItemsScreen />);
    fireEvent.click(screen.getByLabelText("recipe: Lemon Pasta"));

    expect(mockNavigate).toHaveBeenCalledWith("FeaturedRecipeDetail", {
      recipeId: 77,
      recipeType: "mealPlan",
    });
  });

  it("tapping a recipe saved from chat opens the community recipe", () => {
    listOf([
      item({
        id: 2,
        title: "Vegan Tacos",
        recipeId: 88,
        recipeType: "community",
      }),
    ]);

    renderComponent(<SavedItemsScreen />);
    fireEvent.click(screen.getByLabelText("recipe: Vegan Tacos"));

    expect(mockNavigate).toHaveBeenCalledWith("FeaturedRecipeDetail", {
      recipeId: 88,
      recipeType: "community",
    });
  });

  it("a snapshot item with no linked recipe navigates nowhere", () => {
    listOf([item({ id: 3, title: "Morning Walk", type: "activity" })]);

    renderComponent(<SavedItemsScreen />);
    fireEvent.click(screen.getByText("Morning Walk"));

    expect(mockNavigate).not.toHaveBeenCalled();
    // Card renders as a Pressable only with onPress: no button to announce.
    expect(screen.queryByLabelText("activity: Morning Walk")).toBeNull();
  });
});
