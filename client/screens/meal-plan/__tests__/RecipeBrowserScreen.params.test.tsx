// @vitest-environment jsdom
//
// AC #4 of todos/P2-2026-08-15-recipe-browser-modal-param-contract-unenforced.md:
// prove a planned date ARRIVES AS A VALUE THE SCREEN READS. Asserting a
// navigate call's arguments does not prove this — only driving the screen's
// own `isBrowseOnly` branch (RecipeBrowserScreen.tsx:437, handleRecipePress
// at :552-564) does. This is the regression net for Step 3's RootStackNavigator
// rename (`date?` -> `plannedDate?`) — it stays GREEN against the screen's
// current (pre-rename) code too, since the screen already reads
// `plannedDate` off `route.params`; a future `date`-shaped param landing back
// in either navigator's param list would silently fall into the browse-only
// branch, and this test is what would catch that.
//
// Mocking approach mirrors MealPlanHomeScreen.test.tsx's in-repo template:
// render the REAL screen with every collaborator mocked via vi.mock, hooks
// wired through vi.hoisted() so factory closures can reference them.
//
// `@/components/meal-plan/RecipeDiscoveryFeed` is mocked even though the
// task brief's collaborator list doesn't name it. Neither test's routeParams
// includes `searchQuery`, so `debouncedQuery` starts empty and
// `isBlankBrowseState` is true on first render — the screen always shows the
// Discover feed, never the SectionList of search results, no matter what
// `useRecipeSearch` returns. The real feed drills into DiscoveryRow ->
// PresetRecipeRow -> CarouselRecipeCard, all backed by their own
// `useRecipeSearch` calls, which would each render our single stubbed
// recipe — producing duplicate "Test Personal Recipe" text and breaking
// `screen.findByText`. Replacing the whole feed with a single clickable
// element wired to the real `onOpenRecipe` prop (== the screen's own
// `handleRecipePress`, the actual system under test) sidesteps that
// rendering-fanout problem without weakening the assertion: the click still
// runs the screen's real param-driven branch.
//
// `@/hooks/useTheme`, `@/hooks/useHaptics`, and `@/hooks/useAccessibility`
// are deliberately NOT mocked (unlike the brief's suggested list) — all
// three work for real under this harness (useTheme falls back to the
// "light" colorScheme mock; useHaptics/useAccessibility resolve through the
// already-mocked expo-haptics / react-native-reanimated / RN AccessibilityInfo
// primitives) and mocking them added no safety, only more surface to keep in
// sync with the real hooks' shapes.
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import RecipeBrowserScreen from "../RecipeBrowserScreen";

const {
  mockMutateAsync,
  mockNavigate,
  mockGoBack,
  mockRouteParams,
  TEST_RECIPE,
} = vi.hoisted(() => {
  const TEST_RECIPE = {
    id: "mealPlan:42",
    // NOTE: the task brief's draft test described this as
    // `source: "mealPlan"`, but SearchableRecipe's actual `source` union
    // (shared/types/recipe-search.ts) is "personal" | "community" |
    // "spoonacular" — "personal" is what routes handleRecipePress into the
    // add-to-plan / browse-only branch this test targets. The `id` prefix
    // itself is not read for that branching (only `.split(":")[1]` is
    // parsed as the numeric recipe id), so "mealPlan:42" is kept verbatim.
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
    mockMutateAsync: vi.fn(),
    mockNavigate: vi.fn(),
    mockGoBack: vi.fn(),
    mockRouteParams: { value: {} as Record<string, unknown> },
    TEST_RECIPE,
  };
});

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: mockGoBack,
    setOptions: vi.fn(),
  }),
  useRoute: () => ({ params: mockRouteParams.value }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({ isPremium: false }),
}));

vi.mock("@/hooks/useMealPlan", () => ({
  useAddMealPlanItem: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
}));

vi.mock("@/hooks/useFavouriteRecipes", () => ({
  useFavouriteRecipeIds: () => ({ data: { ids: [] } }),
  useToggleFavouriteRecipe: () => ({ mutate: vi.fn() }),
}));

// Screen-level call only (localSearch = useRecipeSearch(showDiscovery ? null
// : searchParams)) — always invoked regardless of showDiscovery, so it must
// resolve without hitting the real network. Its return value is NOT how
// "Test Personal Recipe" reaches the screen — see the RecipeDiscoveryFeed
// mock below for why.
vi.mock("@/hooks/useRecipeSearch", () => ({
  useRecipeSearch: () => ({
    data: { results: [], total: 0 },
    isLoading: false,
    loadMore: undefined,
    isFetchingNextPage: false,
  }),
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

// `useAnimatedScrollHandler` isn't exported by test/mocks/react-native-reanimated.ts
// (only useSharedValue/useAnimatedStyle/etc are) — the real hook crashes
// with "useAnimatedScrollHandler is not a function" under jsdom.
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
  RecipeDiscoveryFeed: ({
    onOpenRecipe,
  }: {
    onOpenRecipe: (recipe: typeof TEST_RECIPE) => void;
  }) =>
    React.createElement(
      "button",
      { onClick: () => onOpenRecipe(TEST_RECIPE) },
      TEST_RECIPE.title,
    ),
}));

describe("RecipeBrowserScreen param contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({ id: 1 });
  });

  it("adds to the plan using the plannedDate param the screen reads", async () => {
    mockRouteParams.value = { mealType: "dinner", plannedDate: "2026-09-01" };
    renderComponent(<RecipeBrowserScreen />);

    fireEvent.click(await screen.findByText("Test Personal Recipe"));

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        recipeId: 42,
        plannedDate: "2026-09-01",
        mealType: "dinner",
      });
    });
    expect(mockNavigate).not.toHaveBeenCalledWith(
      "FeaturedRecipeDetail",
      expect.anything(),
    );
  });

  it("falls back to browse-only when no plannedDate is supplied", async () => {
    mockRouteParams.value = {};
    renderComponent(<RecipeBrowserScreen />);

    fireEvent.click(await screen.findByText("Test Personal Recipe"));

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("FeaturedRecipeDetail", {
        recipeId: 42,
        recipeType: "mealPlan",
      });
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });
});
