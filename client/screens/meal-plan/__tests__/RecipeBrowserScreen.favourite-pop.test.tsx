// @vitest-environment jsdom
/**
 * The search-result card's favourite heart pops (one Success buzz) on
 * favourite and keeps a plain impact tap on unfavourite. Search-results setup
 * borrowed from RecipeBrowserScreen.touch-targets.test.tsx: non-empty
 * useRecipeSearch data plus the shared SectionList mock (which really calls
 * renderItem) mounts the card.
 */
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import RecipeBrowserScreen from "../RecipeBrowserScreen";

const {
  navigation,
  mockToggleFavourite,
  mockTriggerPop,
  mockImpact,
  favouriteData,
  stableToast,
  mockSearchState,
} = vi.hoisted(() => {
  const TEST_RECIPE = {
    id: "mealPlan:42",
    source: "personal" as const,
    userId: "test-user-id",
    title: "Test Personal Recipe",
    description: null,
    ingredients: [],
    cuisine: null,
    dietTags: [],
    mealTypes: [],
    difficulty: null,
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    totalTimeMinutes: null,
    caloriesPerServing: null,
    proteinPerServing: null,
    carbsPerServing: null,
    fatPerServing: null,
    servings: null,
    imageUrl: null,
    sourceUrl: null,
    createdAt: null,
    isCanonical: false,
    allergens: [],
  };
  return {
    navigation: { navigate: vi.fn(), goBack: vi.fn(), setOptions: vi.fn() },
    mockToggleFavourite: vi.fn(),
    mockTriggerPop: vi.fn(),
    mockImpact: vi.fn(),
    favouriteData: { ids: [] as { recipeId: number; recipeType: string }[] },
    stableToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
    mockSearchState: {
      value: {
        data: { results: [TEST_RECIPE], total: 1 },
        isLoading: false,
        loadMore: undefined as (() => void) | undefined,
        isFetchingNextPage: false,
      },
    },
  };
});

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

vi.mock("@gorhom/bottom-sheet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@gorhom/bottom-sheet")>();
  return { ...actual };
});

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => navigation,
  useRoute: () => ({ params: { searchQuery: "chicken" } }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => stableToast,
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({ isPremium: false }),
}));

vi.mock("@/hooks/useMealPlan", () => ({
  useAddMealPlanItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useFavouriteRecipes", () => ({
  useFavouriteRecipeIds: () => ({ data: favouriteData }),
  useToggleFavouriteRecipe: () => ({ mutate: mockToggleFavourite }),
}));

vi.mock("@/hooks/useRecipeSearch", () => ({
  useRecipeSearch: () => mockSearchState.value,
}));

vi.mock("@/hooks/useCatalogSearch", () => ({
  useCatalogSearch: () => ({
    data: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCatalogConfig", () => ({
  useCatalogConfig: () => ({ data: { enabled: true } }),
}));

vi.mock("@/hooks/useScrollLinkedHeader", () => ({
  useScrollLinkedHeader: () => ({
    scrollHandler: vi.fn(),
    headerAnimatedStyle: {},
    isBarVisible: false,
  }),
}));

vi.mock("@/hooks/useSheetBackHandler", () => ({
  useSheetBackHandler: () => ({
    onSheetChange: vi.fn(),
    onSheetAnimate: vi.fn(),
  }),
}));

vi.mock("@/components/meal-plan/SearchFilterSheet", () => ({
  SearchFilterSheet: () => null,
}));

vi.mock("@/components/meal-plan/OnlineSearchCta", () => ({
  OnlineSearchCta: () => null,
}));

vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: () => null,
}));

vi.mock("@/components/meal-plan/RecipeDiscoveryFeed", () => ({
  RecipeDiscoveryFeed: () => null,
}));

describe("RecipeBrowserScreen — favourite heart pop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    favouriteData.ids = [];
  });

  it("pops the heart (one buzz) when favouriting", async () => {
    renderComponent(<RecipeBrowserScreen />);

    fireEvent.click(await screen.findByLabelText("Add to favourites"));

    expect(mockToggleFavourite).toHaveBeenCalledWith({
      recipeId: 42,
      recipeType: "mealPlan",
    });
    expect(mockTriggerPop).toHaveBeenCalledTimes(1);
    expect(mockImpact).not.toHaveBeenCalled();
  });

  it("taps without a pop when unfavouriting", async () => {
    favouriteData.ids = [{ recipeId: 42, recipeType: "mealPlan" }];
    renderComponent(<RecipeBrowserScreen />);

    fireEvent.click(await screen.findByLabelText("Remove from favourites"));

    expect(mockToggleFavourite).toHaveBeenCalledTimes(1);
    expect(mockTriggerPop).not.toHaveBeenCalled();
    expect(mockImpact).toHaveBeenCalledTimes(1);
  });
});
