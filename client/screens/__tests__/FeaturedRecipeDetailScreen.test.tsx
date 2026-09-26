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
import { cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import FeaturedRecipeDetailScreen from "../FeaturedRecipeDetailScreen";
import { ApiError } from "@/lib/api-error";
import { ErrorCode } from "@shared/constants/error-codes";

const { mockApiRequest, mockRouteParams, mockNavigate, mockReset } = vi.hoisted(
  () => ({
    mockApiRequest: vi.fn(),
    mockRouteParams: {
      current: {
        recipeId: 42,
        recipeType: "mealPlan" as const,
      },
    },
    mockNavigate: vi.fn(),
    mockReset: vi.fn(),
  }),
);

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate, reset: mockReset }),
  useRoute: () => ({ params: mockRouteParams.current }),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
  resolveImageUrl: (uri: string | null | undefined) => uri ?? null,
}));

// Thin double — this screen's own error/loading/not-found branching is the
// system under test; RecipeDetailContent's internals (nutrition cards,
// favouriting, cookbook picker, etc.) are a different component's concern.
vi.mock("@/components/RecipeDetailContent", () => ({
  RecipeDetailContent: (props: { title: string }) => (
    <div data-testid="recipe-detail-content">{props.title}</div>
  ),
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
