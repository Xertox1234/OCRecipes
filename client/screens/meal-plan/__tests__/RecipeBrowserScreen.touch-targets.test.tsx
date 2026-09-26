// @vitest-environment jsdom
/**
 * Regression coverage for todos/archive/P2-2026-09-23-touch-targets-regressed-below-44pt.md
 * (M13, 2026-09-23 front-end audit): the favourite (heart) Pressable on a
 * search-result recipe card is 20pt + hitSlop 8 = 36pt, below the 44pt
 * platform minimum.
 *
 * Reuses RecipeBrowserScreen.render-item-stability.test.tsx's search-results
 * setup (non-empty useRecipeSearch data drives the AnimatedSectionList
 * branch), but deliberately does NOT override SectionList — the shared
 * react-native mock's default SectionList implementation (test/mocks/react-native.ts)
 * really invokes `renderItem` for each item, so the recipe card (and its
 * favourite Pressable) actually mounts. Instead, this file captures the raw
 * props (style/hitSlop) the favourite Pressable receives, keyed by
 * accessibilityLabel — the shared mock drops Pressable's `style` before
 * rendering to the DOM, so a DOM-based assertion can't see it either way.
 */
import React from "react";
import { waitFor } from "@testing-library/react";
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
  capturedPressProps,
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
    navigation: {
      navigate: mockNavigate,
      goBack: mockGoBack,
      setOptions: vi.fn(),
    },
    mockToggleFavourite: vi.fn(),
    favouriteData: { ids: [] as { recipeId: number; recipeType: string }[] },
    stableToast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
    mockRouteParams: {
      value: { searchQuery: "chicken" } as Record<string, unknown>,
    },
    // Non-empty results so the screen renders the search-results
    // AnimatedSectionList branch (isBlankBrowseState() is false), which
    // actually mounts RecipeCard-like items via the real SectionList mock.
    mockSearchState: {
      value: {
        data: { results: [TEST_RECIPE], total: 1 },
        isLoading: false,
        loadMore: undefined as (() => void) | undefined,
        isFetchingNextPage: false,
      },
    },
    // Keyed by accessibilityLabel.
    capturedPressProps: {} as Record<string, Record<string, unknown>>,
  };
});

// Captures the favourite Pressable's raw props, then forwards to the real
// (mocked) Pressable — every other Pressable on this screen renders
// unaffected. SectionList is intentionally left at its shared-mock default
// (not overridden) so renderItem is actually invoked.
vi.mock("react-native", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-native")>();
  const CapturingPressable = React.forwardRef<unknown, Record<string, unknown>>(
    (props, ref) => {
      const label = props.accessibilityLabel as string | undefined;
      if (label) capturedPressProps[label] = props;
      return React.createElement(
        actual.Pressable as React.ComponentType<Record<string, unknown>>,
        { ...props, ref },
      );
    },
  );
  CapturingPressable.displayName = "Pressable";
  return { ...actual, Pressable: CapturingPressable };
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

function flattenStyle(
  style: unknown,
  pressed = false,
): Record<string, unknown> {
  if (typeof style === "function") {
    return flattenStyle(
      (style as (state: { pressed: boolean }) => unknown)({ pressed }),
    );
  }
  if (Array.isArray(style)) {
    return style.reduce(
      (acc: Record<string, unknown>, s) => ({ ...acc, ...flattenStyle(s) }),
      {},
    );
  }
  return (style as Record<string, unknown> | null | undefined) ?? {};
}

function flattenHitSlop(hitSlop: unknown): {
  top: number;
  bottom: number;
  left: number;
  right: number;
} {
  if (typeof hitSlop === "number") {
    return { top: hitSlop, bottom: hitSlop, left: hitSlop, right: hitSlop };
  }
  if (hitSlop && typeof hitSlop === "object") {
    const h = hitSlop as Record<string, number>;
    return {
      top: h.top ?? 0,
      bottom: h.bottom ?? 0,
      left: h.left ?? 0,
      right: h.right ?? 0,
    };
  }
  return { top: 0, bottom: 0, left: 0, right: 0 };
}

/** visual box size (explicit width/height, or minWidth/minHeight, or the
 * given fallback) PLUS hitSlop on each axis — hitSlop always adds to the
 * visual box, it never gets shadowed by an explicit size. */
function effectiveTouchSize(
  props: Record<string, unknown> | undefined,
  fallbackVisualSize: number,
): { width: number; height: number } {
  const style = flattenStyle(props?.style);
  const hitSlop = flattenHitSlop(props?.hitSlop);
  const visualWidth =
    typeof style.width === "number"
      ? style.width
      : typeof style.minWidth === "number"
        ? style.minWidth
        : fallbackVisualSize;
  const visualHeight =
    typeof style.height === "number"
      ? style.height
      : typeof style.minHeight === "number"
        ? style.minHeight
        : fallbackVisualSize;
  return {
    width: visualWidth + hitSlop.left + hitSlop.right,
    height: visualHeight + hitSlop.top + hitSlop.bottom,
  };
}

describe("RecipeBrowserScreen — touch targets meet the 44pt minimum (P2-2026-09-23, M13)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({ id: 1 });
    mockRouteParams.value = { searchQuery: "chicken" };
    favouriteData.ids = [];
    for (const key of Object.keys(capturedPressProps)) {
      delete capturedPressProps[key];
    }
  });

  it("the favourite (heart) button reaches 44pt on both axes (visual 20pt icon + hitSlop)", async () => {
    renderComponent(<RecipeBrowserScreen />);

    await waitFor(() => {
      expect(capturedPressProps["Add to favourites"]).toBeDefined();
    });

    // Ionicons "heart-outline"/"heart" is rendered at size={20} (RecipeBrowserScreen.tsx).
    const { width, height } = effectiveTouchSize(
      capturedPressProps["Add to favourites"],
      20,
    );
    expect(width).toBeGreaterThanOrEqual(44);
    expect(height).toBeGreaterThanOrEqual(44);
  });
});
