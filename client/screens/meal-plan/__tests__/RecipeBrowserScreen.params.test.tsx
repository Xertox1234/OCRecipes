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
import { screen, fireEvent, waitFor, act } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import RecipeBrowserScreen from "../RecipeBrowserScreen";

const {
  mockMutateAsync,
  mockNavigate,
  mockGoBack,
  mockRouteParams,
  TEST_RECIPE,
  capturedFilterSheetRef,
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
    // Populated by the @gorhom/bottom-sheet override below — lets the
    // Android-trap-release test call the filter sheet's real `.dismiss()`
    // (mirroring the real user gesture that closes it: backdrop tap or
    // swipe-down — SearchFilterSheet has no in-content close button, unlike
    // ImportRecipeSheetContent's, so this is the only way to exercise the
    // close edge without touching SearchFilterSheet.tsx, which is outside
    // this todo's Scope Contract).
    capturedFilterSheetRef: {
      current: null as { dismiss: () => void } | null,
    },
  };
});

// Wraps the shared BottomSheetModal mock (test/mocks/gorhom-bottom-sheet.ts,
// aliased in vitest.config.ts) only to capture its imperative handle into
// capturedFilterSheetRef above, forwarding the ref through unchanged so
// production's own filterSheetRef.current?.present() still works.
vi.mock("@gorhom/bottom-sheet", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@gorhom/bottom-sheet")>();
  const CapturingBottomSheetModal = React.forwardRef<
    unknown,
    Record<string, unknown>
  >((props, forwardedRef) =>
    React.createElement(
      actual.BottomSheetModal as unknown as React.ComponentType<
        Record<string, unknown>
      >,
      {
        ...props,
        ref: (instance: { dismiss: () => void } | null) => {
          capturedFilterSheetRef.current = instance;
          if (typeof forwardedRef === "function") forwardedRef(instance);
          else if (forwardedRef)
            (forwardedRef as React.MutableRefObject<unknown>).current =
              instance;
        },
      },
    ),
  );
  CapturingBottomSheetModal.displayName = "CapturingBottomSheetModal";
  return { ...actual, BottomSheetModal: CapturingBottomSheetModal };
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

describe("RecipeBrowserScreen — filter sheet iOS a11y-leaf fix", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({ id: 1 });
    mockRouteParams.value = {};
  });

  it("passes accessible={false} to the filter sheet (prevents the iOS a11y-leaf collapse; jsdom cannot verify the native effect)", () => {
    // On new-arch iOS, @gorhom/bottom-sheet's default accessible=true makes the
    // wrapper an accessibility LEAF, hiding the filter sheet's content from
    // VoiceOver AND Maestro (jsdom renders children plainly and cannot see
    // the native leaf-collapse — this only pins that the prop is passed). See
    // docs/solutions/logic-errors/
    // gorhom-bottomsheetmodal-collapses-a11y-subtree-on-ios-2026-09-05.md.
    renderComponent(<RecipeBrowserScreen />);
    expect(
      screen.getByTestId("bottom-sheet-modal").getAttribute("data-accessible"),
    ).toBe("false");
  });
});

// Android TalkBack background focus trap: iOS already has a working trap via
// accessibilityViewIsModal on the sheet's own content root (PR #1000); the
// Android lever is importantForAccessibility="no-hide-descendants" on the
// screen's OWN background content, applied only while the sheet is open. The
// root View here already carries accessibilityViewIsModal (pre-existing,
// unrelated to the filter sheet — see docs/solutions/conventions/
// a11y-viewismodal-on-sheet-content-not-bottomsheetmodal-2026-07-02.md), so
// it's the same per-element target for the new Android prop. jsdom can't
// assert real a11y-tree exclusion — it maps the hiding-prop pair to
// aria-hidden (test/mocks/react-native.ts's ariaHiddenProps), so these tests
// pin THAT, per docs/solutions/conventions/
// jsdom-rn-render-tests-cannot-assert-a11y-tree-hiding-2026-07-03.md.
describe("RecipeBrowserScreen — Android TalkBack background trap", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({ id: 1 });
    mockRouteParams.value = {};
    capturedFilterSheetRef.current = null;
  });

  it("does not hide the background content before the filter sheet opens", () => {
    renderComponent(<RecipeBrowserScreen />);
    expect(
      screen.getByTestId("recipe-browser-root").getAttribute("aria-hidden"),
    ).toBeNull();
  });

  it("hides the background content from the Android accessibility tree while the filter sheet is open", () => {
    renderComponent(<RecipeBrowserScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Advanced filters" }));
    expect(
      screen.getByTestId("recipe-browser-root").getAttribute("aria-hidden"),
    ).toBe("true");
  });

  it("releases the background trap once the filter sheet is dismissed — a trap that never releases makes the screen unusable to TalkBack", () => {
    renderComponent(<RecipeBrowserScreen />);
    fireEvent.click(screen.getByRole("button", { name: "Advanced filters" }));
    expect(
      screen.getByTestId("recipe-browser-root").getAttribute("aria-hidden"),
    ).toBe("true");
    act(() => {
      capturedFilterSheetRef.current?.dismiss();
    });
    expect(
      screen.getByTestId("recipe-browser-root").getAttribute("aria-hidden"),
    ).toBeNull();
  });
});
