// @vitest-environment jsdom
/**
 * Regression test for H4 (2026-09-23 front-end audit,
 * todos/P1-2026-09-23-unstable-mutation-and-haptics-deps-on-compiler-skipped-screens.md):
 * `handleRecipePress` listed the whole `addItemMutation` (useAddMealPlanItem()
 * return) in its own useCallback deps. TanStack Query's useMutation() returns
 * a brand-new wrapper object every render (`{ ...result, mutate, mutateAsync:
 * result.mutate }`), even though `mutateAsync` itself is useCallback-stable
 * underneath — so `handleRecipePress`, and therefore `renderItem` (which
 * depends on it), got a new identity on every RecipeBrowserScreen re-render,
 * including a re-render caused by a single keystroke in the search box (which
 * updates `searchText` synchronously — only the debounced `debouncedQuery`
 * used for the actual search is delayed).
 *
 * Mirrors RecipeBrowserScreen.params.test.tsx's SectionList-capture technique
 * (same pattern CoachChat.render-item-stability.test.tsx uses for FlatList).
 * `useHaptics` is intentionally left unmocked here too (see that file's
 * comment) — with the real hook now memoized (AC #3 of the same todo), the
 * mutation wrapper's fresh-per-call identity is the sole remaining unstable
 * dependency, so this test still discriminates the fix it targets rather
 * than being rescued by the hook-level change.
 */
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import RecipeBrowserScreen from "../RecipeBrowserScreen";

const {
  mockMutateAsync,
  navigation,
  mockToggleFavourite,
  favouriteData,
  stableToast,
  mockRouteParams,
  mockSearchState,
  capturedSectionListProps,
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
  const mockNavigate = vi.fn();
  const mockGoBack = vi.fn();
  return {
    mockMutateAsync: vi.fn(),
    mockNavigate,
    mockGoBack,
    // react-navigation's real useNavigation() returns the SAME memoized
    // object across re-renders — hoisted once here to match (a fresh
    // `{ navigate, goBack, ... }` literal per call, like
    // RecipeBrowserScreen.params.test.tsx's mock uses, would itself defeat
    // this identity assertion for a reason unrelated to the SUT).
    navigation: {
      navigate: mockNavigate,
      goBack: mockGoBack,
      setOptions: vi.fn(),
    },
    mockToggleFavourite: vi.fn(),
    // Hoisted once — a fresh `{ ids: [] }` literal per call (matching a
    // naive mock) would give `favouriteIdSet`'s useMemo (deps: [favouriteData])
    // a new identity every render for a reason unrelated to this test.
    favouriteData: { ids: [] as { recipeId: number; recipeType: string }[] },
    // useToast() is a useMemo'd context value in production
    // (ToastContext.tsx) — genuinely stable across re-renders.
    stableToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
    mockRouteParams: {
      value: { searchQuery: "chicken" } as Record<string, unknown>,
    },
    // Non-empty results so the screen renders the search-results
    // AnimatedSectionList branch instead of the empty state or the
    // (mocked) RecipeDiscoveryFeed — see RecipeBrowserScreen.tsx: with
    // debouncedQuery.length > 0, isBlankBrowseState() is false, so the
    // Discover feed never mounts regardless of what useRecipeSearch returns.
    mockSearchState: {
      value: {
        data: { results: [TEST_RECIPE], total: 1 },
        isLoading: false,
        loadMore: undefined as (() => void) | undefined,
        isFetchingNextPage: false,
      },
    },
    capturedSectionListProps: {
      value: undefined as Record<string, unknown> | undefined,
    },
    TEST_RECIPE,
  };
});

// Same override technique as RecipeBrowserScreen.params.test.tsx's L9 test —
// capture the exact props the screen passes to its search-results list.
vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const SectionList = React.forwardRef<unknown, Record<string, unknown>>(
    (props, _ref) => {
      capturedSectionListProps.value = props;
      return null;
    },
  );
  SectionList.displayName = "SectionList";
  return { ...actual, SectionList };
});

vi.mock("@gorhom/bottom-sheet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@gorhom/bottom-sheet")>();
  return { ...actual };
});

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => navigation,
  useRoute: () => ({ params: mockRouteParams.value }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => stableToast,
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({ isPremium: false }),
}));

// Fresh wrapper object every call (faithful to real useMutation), but a
// stable `mutateAsync` inside it — handleRecipePress must destructure
// mutateAsync specifically, never depend on the whole mutation object.
vi.mock("@/hooks/useMealPlan", () => ({
  useAddMealPlanItem: () => ({
    mutateAsync: mockMutateAsync,
    isPending: false,
  }),
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

describe("RecipeBrowserScreen — renderItem identity stability across a search keystroke (H4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({ id: 1 });
    mockRouteParams.value = { searchQuery: "chicken" };
    capturedSectionListProps.value = undefined;
  });

  it("keeps the SectionList renderItem prop referentially stable when a keystroke updates the (debounced) search text", async () => {
    renderComponent(<RecipeBrowserScreen />);

    // Denominator (part 1): the results list actually mounted.
    await waitFor(() => {
      expect(capturedSectionListProps.value).toBeDefined();
    });

    const firstProps = capturedSectionListProps.value;
    const firstRenderItem = firstProps?.renderItem;
    expect(typeof firstRenderItem).toBe("function");

    const input = screen.getByDisplayValue("chicken");
    fireEvent.change(input, { target: { value: "chicken t" } });

    // Denominator (part 2): prove the keystroke actually reached the screen
    // and caused a re-render — the input's own displayed value is the most
    // direct signal, and a fresh SectionList props object is a second,
    // independent one (JSX always creates a fresh props object on any
    // parent re-render).
    expect((input as HTMLInputElement).value).toBe("chicken t");
    const secondProps = capturedSectionListProps.value;
    expect(secondProps).not.toBe(firstProps);

    const secondRenderItem = secondProps?.renderItem;
    expect(secondRenderItem).toBe(firstRenderItem);
  });
});
