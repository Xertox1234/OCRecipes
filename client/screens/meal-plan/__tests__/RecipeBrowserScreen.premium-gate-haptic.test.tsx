// @vitest-environment jsdom
//
// The free-user premium gate in handleFiltersChange must not tick a haptic of
// its own: every SearchFilterSheet control that calls onFiltersChange has
// already ticked (selectable Chips tick in Chip.handlePress, sliders tick in
// onSlidingComplete), so a tick here was a double buzz.
//
// No sheet control can pick the "spoonacular" source today (its "Online" chip
// was removed in #459), so this drives the handler directly through a
// captured onFiltersChange rather than through a chip press.
//
// Mock harness trimmed from RecipeBrowserScreen.loading-skeleton.test.tsx.
import React from "react";
import { act } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../../test/utils/render-component";
import RecipeBrowserScreen from "../RecipeBrowserScreen";
import type { SearchFilters } from "@/components/meal-plan/SearchFilterSheet";

const { captured } = vi.hoisted(() => ({
  captured: {
    onFiltersChange: null as ((f: SearchFilters) => void) | null,
    filters: null as SearchFilters | null,
    upgradeVisible: false,
  },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: vi.fn(),
    goBack: vi.fn(),
    setOptions: vi.fn(),
  }),
  useRoute: () => ({ params: {} }),
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
  SearchFilterSheet: (props: {
    filters: SearchFilters;
    onFiltersChange: (f: SearchFilters) => void;
  }) => {
    captured.onFiltersChange = props.onFiltersChange;
    captured.filters = props.filters;
    return null;
  },
}));

vi.mock("@/components/meal-plan/OnlineSearchCta", () => ({
  OnlineSearchCta: () => null,
}));

vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: (props: { visible: boolean }) => {
    captured.upgradeVisible = props.visible;
    return null;
  },
}));

vi.mock("@/components/meal-plan/RecipeDiscoveryFeed", () => ({
  RecipeDiscoveryFeed: () => null,
}));

describe("RecipeBrowserScreen — premium source gate", () => {
  beforeEach(() => {
    captured.onFiltersChange = null;
    captured.filters = null;
    captured.upgradeVisible = false;
  });

  it("opens the upgrade prompt without a second haptic tick", () => {
    renderComponent(<RecipeBrowserScreen />);
    expect(captured.onFiltersChange).not.toBeNull();
    vi.mocked(Haptics.selectionAsync).mockClear();

    act(() => {
      captured.onFiltersChange!({
        ...captured.filters!,
        source: "spoonacular",
      });
    });

    expect(captured.upgradeVisible).toBe(true);
    // The control that fired onFiltersChange already ticked.
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
    // The filter state stays honest: the gated source is not applied.
    expect(captured.filters?.source).toBe("all");
  });
});
