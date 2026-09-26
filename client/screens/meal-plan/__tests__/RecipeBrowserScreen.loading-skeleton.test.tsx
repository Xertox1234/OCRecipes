// @vitest-environment jsdom
//
// P2-2026-09-23 (M15): RecipeBrowserScreen's loading skeleton must be one
// hidden region (both platforms) with a delayed announce, not a container
// whose own accessibilityLabel is hidden along with the decorative boxes.
//
// Mocking approach mirrors RecipeBrowserScreen.params.test.tsx's harness,
// trimmed to what's needed to reach the `isLoading` branch: `showDiscovery`
// must be false, which route.params.searchQuery achieves directly (it seeds
// `debouncedQuery`'s initial state, skipping the debounce delay) without
// needing to drive the search input.
import React from "react";
import { screen } from "@testing-library/react";
import * as RN from "react-native";
import { renderComponent } from "../../../../test/utils/render-component";
import RecipeBrowserScreen from "../RecipeBrowserScreen";

const { mockRouteParams, mockSearchState, DEFAULT_SEARCH_STATE } = vi.hoisted(
  () => {
    const DEFAULT_SEARCH_STATE = {
      data: { results: [], total: 0 },
      isLoading: false,
      loadMore: undefined as (() => void) | undefined,
      isFetchingNextPage: false,
    };
    return {
      mockRouteParams: { value: {} as Record<string, unknown> },
      mockSearchState: { value: { ...DEFAULT_SEARCH_STATE } },
      DEFAULT_SEARCH_STATE,
    };
  },
);

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: vi.fn(),
    goBack: vi.fn(),
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
  useAddMealPlanItem: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/hooks/useFavouriteRecipes", () => ({
  useFavouriteRecipeIds: () => ({ data: { ids: [] } }),
  useToggleFavouriteRecipe: () => ({ mutate: vi.fn() }),
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

// searchQuery seeds debouncedQuery's initial state directly, so
// showDiscovery is false from first render — no need to drive the search
// input or wait out the debounce.
function renderLoading() {
  mockRouteParams.value = { searchQuery: "pasta" };
  mockSearchState.value = { ...DEFAULT_SEARCH_STATE, isLoading: true };
  return renderComponent(<RecipeBrowserScreen />);
}

describe("RecipeBrowserScreen — loading skeleton screen-reader signal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    mockSearchState.value = { ...DEFAULT_SEARCH_STATE };
  });

  it("hides the skeleton region from screen readers as one unit", () => {
    renderLoading();
    const region = screen.getByTestId("recipe-browser-loading-skeleton");
    expect(region.getAttribute("aria-hidden")).toBe("true");
  });

  // Fails on main: today the region itself carries `accessibilityLabel=
  // "Loading..."` alongside `accessibilityElementsHidden`, which hides the
  // label along with the decorative boxes on iOS.
  it("does not carry its own hidden Loading label", () => {
    renderLoading();
    expect(screen.queryByLabelText("Loading...")).toBeNull();
  });

  it("does not announce Loading synchronously, then announces it once after the delay", () => {
    const announceSpy = vi.spyOn(
      RN.AccessibilityInfo,
      "announceForAccessibility",
    );
    try {
      renderLoading();

      expect(announceSpy).not.toHaveBeenCalledWith("Loading");

      vi.advanceTimersByTime(500);

      expect(announceSpy).toHaveBeenCalledExactlyOnceWith("Loading");
    } finally {
      announceSpy.mockRestore();
    }
  });

  it("does not announce a stale Loading when loading ends before the delay elapses", () => {
    const announceSpy = vi.spyOn(
      RN.AccessibilityInfo,
      "announceForAccessibility",
    );
    try {
      const { rerender } = renderLoading();
      vi.advanceTimersByTime(200);
      mockSearchState.value = { ...DEFAULT_SEARCH_STATE, isLoading: false };
      rerender(<RecipeBrowserScreen />);
      vi.advanceTimersByTime(500);

      expect(announceSpy).not.toHaveBeenCalledWith("Loading");
    } finally {
      announceSpy.mockRestore();
    }
  });

  it("cancels the pending Loading announce if the screen unmounts before the delay elapses", () => {
    const announceSpy = vi.spyOn(
      RN.AccessibilityInfo,
      "announceForAccessibility",
    );
    try {
      const { unmount } = renderLoading();
      unmount();
      vi.advanceTimersByTime(500);

      expect(announceSpy).not.toHaveBeenCalledWith("Loading");
    } finally {
      announceSpy.mockRestore();
    }
  });
});
