// @vitest-environment jsdom
//
// P2-2026-09-23 (M19, 2026-09-23 front-end audit): FeaturedRecipeDetailScreen
// previously collapsed EVERY query failure (network, 5xx, a genuine 404) into
// the same static "Recipe not found" copy with no retry — a network blip and
// a permanently-missing recipe are not the same failure, and telling the user
// "not found" for a transient error asserts a false cause (see
// docs/solutions/logic-errors/network-failure-rendered-as-wrong-credentials-2026-08-08.md).
//
// Exercises the screen through its `recipeType: "mealPlan"` branch only,
// which has an explicit `apiRequest`-backed queryFn that's easy to mock and
// reject with a real `ApiError`. The `community` branch uses the QueryClient's
// default queryFn (`getQueryFn`), which `renderComponent`'s bare test
// QueryClient does not register — the error-branching logic under test
// (isNotFoundError / EmptyState / retry) is shared by both branches
// regardless of which query supplies the error, so this is full coverage of
// the fix, not a narrowed one.
import React from "react";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as RN from "react-native";
import { renderComponent } from "../../../test/utils/render-component";
import FeaturedRecipeDetailScreen from "../FeaturedRecipeDetailScreen";
import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";

const {
  mockApiRequest,
  mockRouteParams,
  mockNavigate,
  mockReset,
  mockReplace,
  mockDetailProps,
} = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  mockRouteParams: {
    current: {
      recipeId: 42,
      recipeType: "mealPlan",
    } as {
      recipeId: number;
      recipeType: "mealPlan" | "community" | "catalog";
    },
  },
  mockNavigate: vi.fn(),
  mockReset: vi.fn(),
  mockReplace: vi.fn(),
  mockDetailProps: { current: null as Record<string, unknown> | null },
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    reset: mockReset,
    replace: mockReplace,
  }),
  useRoute: () => ({ params: mockRouteParams.current }),
}));

vi.mock("@/lib/query-client", async (importOriginal) => ({
  // The real predicate: the screen defers to it to know when the global
  // error toast will announce a failure itself.
  shouldSurfaceQueryError: (
    await importOriginal<typeof import("@/lib/query-client")>()
  ).shouldSurfaceQueryError,
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  resolveImageUrl: (uri: string | null | undefined) => uri ?? null,
}));

// Thin double — this screen's own error/loading/not-found branching is the
// system under test; RecipeDetailContent's internals (nutrition cards,
// favouriting, cookbook picker, etc.) are a different component's concern.
vi.mock("@/components/RecipeDetailContent", () => ({
  RecipeDetailContent: (props: { title: string } & Record<string, unknown>) => {
    mockDetailProps.current = props;
    return <div data-testid="recipe-detail-content">{props.title}</div>;
  },
}));

vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: ({ visible }: { visible: boolean }) =>
    visible ? <div data-testid="upgrade-modal" /> : null,
}));

vi.mock("@/components/recipe-detail", () => ({
  RecipeDetailSkeleton: () => <div data-testid="recipe-detail-skeleton" />,
}));

beforeEach(() => {
  mockRouteParams.current = { recipeId: 42, recipeType: "mealPlan" };
  mockApiRequest.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("FeaturedRecipeDetailScreen — generic errors get a retry, not 'Recipe not found'", () => {
  it("shows generic error copy + Try Again for a network failure", async () => {
    mockApiRequest.mockRejectedValue(new TypeError("Network request failed"));

    renderComponent(<FeaturedRecipeDetailScreen />);

    expect(await screen.findByText("Couldn't load this recipe")).toBeDefined();
    expect(screen.getByText("Try Again")).toBeDefined();
    expect(screen.queryByText("Recipe not found")).toBeNull();
  });

  it("shows generic error copy + Try Again for a 500", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiError("500: Internal Server Error", ErrorCode.INTERNAL_ERROR, 500),
    );

    renderComponent(<FeaturedRecipeDetailScreen />);

    expect(await screen.findByText("Couldn't load this recipe")).toBeDefined();
    expect(screen.getByText("Try Again")).toBeDefined();
  });

  it("calls the query's refetch when Try Again is pressed", async () => {
    mockApiRequest.mockRejectedValue(new TypeError("Network request failed"));

    renderComponent(<FeaturedRecipeDetailScreen />);
    await screen.findByText("Try Again");
    const callsBeforeRetry = mockApiRequest.mock.calls.length;

    fireEvent.click(screen.getByText("Try Again"));

    await waitFor(() => {
      expect(mockApiRequest.mock.calls.length).toBeGreaterThan(
        callsBeforeRetry,
      );
    });
  });
});

describe("FeaturedRecipeDetailScreen — a genuine 404 is 'not found', not a retryable error", () => {
  it("shows 'Recipe not found' with no retry button for a 404", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiError("404: Recipe not found", ErrorCode.NOT_FOUND, 404),
    );

    renderComponent(<FeaturedRecipeDetailScreen />);

    expect(await screen.findByText("Recipe not found")).toBeDefined();
    expect(screen.queryByText("Try Again")).toBeNull();
    expect(screen.queryByText("Couldn't load this recipe")).toBeNull();
  });
});

describe("FeaturedRecipeDetailScreen — generic error is announced for screen readers", () => {
  let announceSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    announceSpy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
  });

  afterEach(() => {
    announceSpy.mockRestore();
  });

  it("announces once when the generic-error state is reached", async () => {
    mockApiRequest.mockRejectedValue(new TypeError("Network request failed"));

    renderComponent(<FeaturedRecipeDetailScreen />);
    await screen.findByText("Couldn't load this recipe");

    expect(announceSpy).toHaveBeenCalledExactlyOnceWith(
      "Couldn't load this recipe. Try again.",
    );
  });

  it("announces 'Recipe not found.' (not the generic-error copy) for a 404", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiError("404: Recipe not found", ErrorCode.NOT_FOUND, 404),
    );

    renderComponent(<FeaturedRecipeDetailScreen />);
    await screen.findByText("Recipe not found");

    expect(announceSpy).toHaveBeenCalledExactlyOnceWith("Recipe not found.");
  });

  it("does not announce on the happy path", async () => {
    mockApiRequest.mockResolvedValue({
      json: async () => ({ id: 42, title: "Pancakes", ingredients: [] }),
    });

    renderComponent(<FeaturedRecipeDetailScreen />);
    await screen.findByText("Pancakes");

    expect(announceSpy).not.toHaveBeenCalled();
  });
});

// The community query keeps the global error toast (RecipeChatScreen shares
// its key and has no error UI of its own). Toast.tsx announces its message on
// iOS, and it lands in the same commit as this screen's own announcement —
// iOS drops one of two same-commit announcements. So when the toast will
// surface the error (network/5xx), the screen stays quiet; a 404 is
// suppressed by the toast net, so the screen still announces it.
describe("FeaturedRecipeDetailScreen — community errors don't double-announce with the global toast", () => {
  let announceSpy: ReturnType<typeof vi.spyOn>;

  function renderCommunity(queryError: Error) {
    mockRouteParams.current = {
      recipeId: 42,
      recipeType: "community",
    } as unknown as typeof mockRouteParams.current;
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          queryFn: () => Promise.reject(queryError),
        },
      },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <FeaturedRecipeDetailScreen />
      </QueryClientProvider>,
    );
  }

  beforeEach(() => {
    announceSpy = vi.spyOn(RN.AccessibilityInfo, "announceForAccessibility");
  });

  afterEach(() => {
    announceSpy.mockRestore();
    cleanup();
    mockRouteParams.current = { recipeId: 42, recipeType: "mealPlan" };
  });

  it("does not announce a network failure the global toast will announce", async () => {
    renderCommunity(new TypeError("Network request failed"));
    await screen.findByText("Couldn't load this recipe");

    expect(announceSpy).not.toHaveBeenCalled();
  });

  it("still announces a 404, which the global toast suppresses", async () => {
    renderCommunity(
      new ApiError("404: Recipe not found", ErrorCode.NOT_FOUND, 404),
    );
    await screen.findByText("Recipe not found");

    expect(announceSpy).toHaveBeenCalledExactlyOnceWith("Recipe not found.");
  });
});

// The meal-plan recipe query renders its own error UI (above) and its key has
// no other live reader (useMealPlanRecipeDetail has no production call site),
// so it opts out of the global QueryCache error toast — otherwise a failure
// shows BOTH the inline error and a toast. The community query must NOT opt
// out: RecipeChatScreen shares `/api/recipes/${id}` with no error UI of its
// own and relies on the global toast.
describe("FeaturedRecipeDetailScreen — global error toast opt-out", () => {
  it("marks the meal-plan recipe query silentError, but not the shared community query", async () => {
    mockApiRequest.mockRejectedValue(new TypeError("Network request failed"));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <FeaturedRecipeDetailScreen />
      </QueryClientProvider>,
    );
    await screen.findByText("Couldn't load this recipe");

    const cache = queryClient.getQueryCache();
    expect(
      cache.find({ queryKey: ["/api/meal-plan/recipes", 42] })?.meta,
    ).toEqual({ silentError: true });
    const communityQuery = cache.find({ queryKey: ["/api/recipes/42"] });
    expect(communityQuery).toBeDefined();
    expect(communityQuery?.meta?.silentError).toBeUndefined();
  });
});

describe("FeaturedRecipeDetailScreen — happy path is unaffected", () => {
  it("renders the loaded recipe via RecipeDetailContent", async () => {
    mockApiRequest.mockResolvedValue({
      json: async () => ({
        id: 42,
        title: "Pancakes",
        ingredients: [],
      }),
    });

    renderComponent(<FeaturedRecipeDetailScreen />);

    expect(await screen.findByText("Pancakes")).toBeDefined();
    expect(screen.queryByText("Recipe not found")).toBeNull();
    expect(screen.queryByText("Couldn't load this recipe")).toBeNull();
  });
});

describe("FeaturedRecipeDetailScreen — catalog (Spoonacular) preview", () => {
  const catalogDetail = {
    recipe: {
      title: "Spoonacular Chili",
      description: "Warm",
      servings: 4,
      prepTimeMinutes: 10,
      cookTimeMinutes: 30,
      imageUrl: null,
      instructions: ["Cook"],
      dietTags: [],
      caloriesPerServing: "420",
      proteinPerServing: "30",
      carbsPerServing: "40",
      fatPerServing: "12",
    },
    ingredients: [{ name: "beans", quantity: "1", unit: "can" }],
  };

  beforeEach(() => {
    mockRouteParams.current = { recipeId: 715538, recipeType: "catalog" };
    mockDetailProps.current = null;
  });

  function mockCatalogApi(saveResult: unknown = { id: 901 }) {
    mockApiRequest.mockImplementation(async (method: string) =>
      method === "GET"
        ? { json: async () => catalogDetail }
        : saveResult instanceof Error
          ? Promise.reject(saveResult)
          : { json: async () => saveResult },
    );
  }

  it("fetches the preview from the catalog endpoint, not /api/recipes", async () => {
    mockCatalogApi();
    renderComponent(<FeaturedRecipeDetailScreen />);
    expect(await screen.findByText("Spoonacular Chili")).toBeDefined();
    expect(mockApiRequest).toHaveBeenCalledWith(
      "GET",
      "/api/meal-plan/catalog/715538",
    );
  });

  it("hands RecipeDetailContent recipeId 0 so favourite/cookbook/remix never touch a DB row", async () => {
    mockCatalogApi();
    renderComponent(<FeaturedRecipeDetailScreen />);
    await screen.findByText("Spoonacular Chili");
    expect(mockDetailProps.current?.recipeId).toBe(0);
    expect(mockDetailProps.current?.recipeType).toBe("mealPlan");
  });

  it("saves via the catalog save endpoint, shows the saved state, and opens the saved copy", async () => {
    mockCatalogApi({ id: 901 });
    renderComponent(<FeaturedRecipeDetailScreen />);
    fireEvent.click(
      await screen.findByLabelText("Save Spoonacular Chili to your recipes"),
    );
    expect(await screen.findByText("Saved · View recipe")).toBeDefined();
    expect(mockApiRequest).toHaveBeenCalledWith(
      "POST",
      "/api/meal-plan/catalog/715538/save",
    );
    fireEvent.click(
      screen.getByLabelText("Saved. Open Spoonacular Chili in your recipes"),
    );
    expect(mockReplace).toHaveBeenCalledWith("FeaturedRecipeDetail", {
      recipeId: 901,
      recipeType: "mealPlan",
    });
  });

  it("shows an inline error when Save fails", async () => {
    mockCatalogApi(new TypeError("Network request failed"));
    renderComponent(<FeaturedRecipeDetailScreen />);
    fireEvent.click(
      await screen.findByLabelText("Save Spoonacular Chili to your recipes"),
    );
    expect(
      await screen.findByText("Couldn't save this recipe. Try again."),
    ).toBeDefined();
  });

  it("shows the Premium state for a 403 PREMIUM_REQUIRED", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiError(
        "403: Recipe catalog requires a premium subscription",
        ErrorCode.PREMIUM_REQUIRED,
        403,
      ),
    );
    renderComponent(<FeaturedRecipeDetailScreen />);
    expect(
      await screen.findByText("Online recipes are a Premium feature"),
    ).toBeDefined();
    expect(screen.queryByText("Try Again")).toBeNull();
    fireEvent.click(screen.getByText("See Premium"));
    expect(screen.getByTestId("upgrade-modal")).toBeDefined();
  });

  it("shows 'Recipe not found' for a catalog 404", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiError(
        "404: Recipe not found in catalog",
        ErrorCode.NOT_FOUND,
        404,
      ),
    );
    renderComponent(<FeaturedRecipeDetailScreen />);
    expect(await screen.findByText("Recipe not found")).toBeDefined();
    expect(screen.queryByText("Try Again")).toBeNull();
    // The no-data fallback also reads "Recipe not found" — pin that this is
    // the catalog request's 404, not a branch that never fetched.
    expect(mockApiRequest).toHaveBeenCalledWith(
      "GET",
      "/api/meal-plan/catalog/715538",
    );
  });

  it("shows the unavailable state for a 402 quota error", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiError(
        "402: Spoonacular API quota exceeded",
        ErrorCode.CATALOG_QUOTA_EXCEEDED,
        402,
      ),
    );
    renderComponent(<FeaturedRecipeDetailScreen />);
    expect(
      await screen.findByText("Spoonacular isn't available right now"),
    ).toBeDefined();
  });
});
