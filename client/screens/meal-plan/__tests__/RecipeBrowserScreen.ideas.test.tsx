// @vitest-environment jsdom
//
// "Ideas for you" (inspired recipes, spec 2026-10-12): the Recipe Browser's
// below-results CTA asks the server for AI-written idea cards for the current
// query, renders them as SuggestionCards, and "Make this mine" opens the
// generated recipe.
//
// Mock harness trimmed from RecipeBrowserScreen.premium-gate-haptic.test.tsx.
// useInspiredSuggestions is replaced by a small stateful stand-in so the
// listing's data/pending/error flow through the screen the way TanStack's
// useMutation would surface them.
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import RecipeBrowserScreen from "../RecipeBrowserScreen";
import { ApiError } from "@/lib/api-error";
import type { Suggestion } from "@shared/schemas/inspired-recipes";

const { mutateAsync, makeMutateAsync, navigate, toastError, premium } =
  vi.hoisted(() => ({
    mutateAsync: vi.fn(),
    makeMutateAsync: vi.fn(),
    navigate: vi.fn(),
    toastError: vi.fn(),
    premium: { value: true },
  }));

const card: Suggestion = {
  id: 7,
  title: "Bean Tacos",
  description: "Smoky black beans, lime slaw and warm corn tortillas.",
  totalMinutes: 25,
  tags: ["vegetarian"],
  imageUrl: null,
  madeRecipeId: null,
};

vi.mock("@/hooks/useInspiredSuggestions", async () => {
  const ReactActual = await import("react");
  const EMPTY_PHOTOS = new Map<number, string | null>();
  return {
    useCreateSuggestionListing: () => {
      const [data, setData] = ReactActual.useState<Suggestion[] | undefined>(
        undefined,
      );
      const [error, setError] = ReactActual.useState<ApiError | null>(null);
      const [isPending, setIsPending] = ReactActual.useState(false);
      const mutate = ReactActual.useCallback((body: unknown) => {
        setIsPending(true);
        setError(null);
        Promise.resolve(mutateAsync(body))
          .then((result: Suggestion[]) => setData(result))
          .catch((e: ApiError) => setError(e))
          .finally(() => setIsPending(false));
      }, []);
      const reset = ReactActual.useCallback(() => {
        setData(undefined);
        setError(null);
      }, []);
      return { data, error, isPending, mutate, reset };
    },
    useSuggestionPhotos: () => EMPTY_PHOTOS,
    useMakeSuggestion: () => ({ mutateAsync: makeMutateAsync }),
  };
});

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate, goBack: vi.fn(), setOptions: vi.fn() }),
  useRoute: () => ({ params: { searchQuery: "tacos" } }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: vi.fn(), error: toastError, info: vi.fn() }),
}));

vi.mock("@/context/PremiumContext", () => ({
  usePremiumContext: () => ({ isPremium: premium.value }),
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
  UpgradeModal: () => null,
}));

vi.mock("@/components/meal-plan/RecipeDiscoveryFeed", () => ({
  RecipeDiscoveryFeed: () => null,
}));

describe("RecipeBrowserScreen — Ideas for you", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    premium.value = true;
  });

  it("tapping the CTA requests ideas for the current query and renders the cards", async () => {
    mutateAsync.mockResolvedValue([card]);
    renderComponent(<RecipeBrowserScreen />);

    fireEvent.click(screen.getByText("Get ideas made for you"));

    expect(mutateAsync).toHaveBeenCalledWith({ query: "tacos" });
    expect(await screen.findByText("Bean Tacos")).toBeTruthy();
    expect(screen.getByText("Ideas for you")).toBeTruthy();
  });

  it("Make this mine navigates to the new recipe", async () => {
    mutateAsync.mockResolvedValue([card]);
    makeMutateAsync.mockResolvedValue({ recipeId: 88 });
    renderComponent(<RecipeBrowserScreen />);

    fireEvent.click(screen.getByText("Get ideas made for you"));
    await screen.findByText("Bean Tacos");
    fireEvent.click(screen.getByLabelText("Make Bean Tacos mine"));

    expect(makeMutateAsync).toHaveBeenCalledWith(7);
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("FeaturedRecipeDetail", {
        recipeId: 88,
        recipeType: "community",
      }),
    );
  });

  it("an expired idea tells the user to search again and clears the cards", async () => {
    mutateAsync.mockResolvedValue([card]);
    makeMutateAsync.mockRejectedValue(
      new ApiError("410: expired", "SUGGESTION_EXPIRED", 410),
    );
    renderComponent(<RecipeBrowserScreen />);

    fireEvent.click(screen.getByText("Get ideas made for you"));
    await screen.findByText("Bean Tacos");
    fireEvent.click(screen.getByLabelText("Make Bean Tacos mine"));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "These ideas expired — search again.",
      ),
    );
    await waitFor(() => expect(screen.queryByText("Bean Tacos")).toBeNull());
    expect(navigate).not.toHaveBeenCalled();
  });

  it("the daily idea cap shows the limit copy on the CTA", async () => {
    mutateAsync.mockRejectedValue(
      new ApiError("429: limit", "DAILY_LIMIT_REACHED", 429),
    );
    renderComponent(<RecipeBrowserScreen />);

    fireEvent.click(screen.getByText("Get ideas made for you"));

    expect(
      await screen.findByText("You've reached today's limit for recipe ideas."),
    ).toBeTruthy();
  });

  it("a generic listing failure offers a retry", async () => {
    mutateAsync.mockRejectedValue(
      new ApiError("502: unavailable", "AI_UNAVAILABLE", 502),
    );
    renderComponent(<RecipeBrowserScreen />);

    fireEvent.click(screen.getByText("Get ideas made for you"));

    expect(
      await screen.findByText("Couldn't come up with ideas. Tap to retry."),
    ).toBeTruthy();
  });
});
