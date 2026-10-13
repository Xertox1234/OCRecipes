// @vitest-environment jsdom
//
// "Ideas for you" is premium: a free user tapping the CTA gets the upgrade
// prompt — with exactly one haptic tick — and no idea listing is requested.
// (Replaces the old Spoonacular "Online" source gate, removed with the
// Spoonacular browse path in the inspired-recipes work.)
//
// Mock harness trimmed from RecipeBrowserScreen.loading-skeleton.test.tsx.
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import * as Haptics from "expo-haptics";
import { renderComponent } from "../../../../test/utils/render-component";
import RecipeBrowserScreen from "../RecipeBrowserScreen";

const { captured, mutate } = vi.hoisted(() => ({
  captured: { upgradeVisible: false },
  mutate: vi.fn(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: vi.fn(),
    goBack: vi.fn(),
    setOptions: vi.fn(),
  }),
  useRoute: () => ({ params: { searchQuery: "tacos" } }),
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

vi.mock("@/hooks/useInspiredSuggestions", () => {
  // Stable identities, as TanStack's mutate/reset/mutateAsync are.
  const listing = {
    data: undefined,
    isPending: false,
    error: null,
    mutate,
    reset: vi.fn(),
  };
  const make = { mutateAsync: vi.fn() };
  const photos = new Map<number, string | null>();
  return {
    useCreateSuggestionListing: () => listing,
    useMakeSuggestion: () => make,
    useSuggestionPhotos: () => photos,
  };
});

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

vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: (props: { visible: boolean }) => {
    captured.upgradeVisible = props.visible;
    return null;
  },
}));

vi.mock("@/components/meal-plan/RecipeDiscoveryFeed", () => ({
  RecipeDiscoveryFeed: () => null,
}));

describe("RecipeBrowserScreen — Ideas for you premium gate", () => {
  beforeEach(() => {
    captured.upgradeVisible = false;
    mutate.mockClear();
  });

  it("opens the upgrade prompt with a single haptic tick", () => {
    renderComponent(<RecipeBrowserScreen />);
    vi.mocked(Haptics.selectionAsync).mockClear();

    fireEvent.click(screen.getByText("Ideas for you · Premium"));

    expect(captured.upgradeVisible).toBe(true);
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(mutate).not.toHaveBeenCalled();
  });
});
