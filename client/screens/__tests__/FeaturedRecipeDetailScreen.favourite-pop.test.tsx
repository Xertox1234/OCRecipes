// @vitest-environment jsdom
//
// The catalog preview's heart: a saved copy toggles optimistically, so its
// heart pops at tap (the pop fires its own Success haptic). An unsaved preview
// saves first, so the pop waits until the favourite has actually landed — a
// failed save or favourite never celebrates. Harness borrowed from
// FeaturedRecipeDetailScreen.test.tsx's catalog suite (real hooks, mocked
// apiRequest).
import React from "react";
import { cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import FeaturedRecipeDetailScreen from "../FeaturedRecipeDetailScreen";

const { mockApiRequest, mockTriggerPop, mockImpact, favouriteIds } = vi.hoisted(
  () => ({
    mockApiRequest: vi.fn(),
    mockTriggerPop: vi.fn(),
    mockImpact: vi.fn(),
    favouriteIds: {
      current: [] as { recipeId: number; recipeType: string }[],
    },
  }),
);

vi.mock("@/hooks/useSuccessAnimation", () => ({
  useSuccessPop: () => ({
    trigger: mockTriggerPop,
    animatedStyle: {},
    scale: { value: 1 },
  }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: mockImpact,
    selection: vi.fn(),
    notification: vi.fn(),
  }),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    navigate: vi.fn(),
    reset: vi.fn(),
    replace: vi.fn(),
  }),
  useRoute: () => ({ params: { recipeId: 715538, recipeType: "catalog" } }),
}));

vi.mock("@/lib/query-client", async (importOriginal) => ({
  shouldSurfaceQueryError: (
    await importOriginal<typeof import("@/lib/query-client")>()
  ).shouldSurfaceQueryError,
  apiRequest: (...args: unknown[]) =>
    args[1] === "/api/favourite-recipes/ids"
      ? Promise.resolve({ json: async () => ({ ids: favouriteIds.current }) })
      : mockApiRequest(...args),
  resolveImageUrl: (uri: string | null | undefined) => uri ?? null,
}));

vi.mock("@/components/RecipeDetailContent", () => ({
  RecipeDetailContent: (props: { title: string }) => (
    <div data-testid="recipe-detail-content">{props.title}</div>
  ),
}));

vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: () => null,
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

vi.mock("@/components/recipe-detail", () => ({
  RecipeDetailSkeleton: () => <div data-testid="recipe-detail-skeleton" />,
}));

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

const FAVOURITE_TOGGLE_URL = "/api/favourite-recipes/toggle";
const ADD_LABEL = "Add Spoonacular Chili to favourites";
const REMOVE_LABEL = "Remove Spoonacular Chili from favourites";
const SAVE_LABEL = "Save Spoonacular Chili to your recipes";

/** `toggle` answers the favourite toggle; `save` answers the catalog save. */
function mockCatalogApi({
  save = () => Promise.resolve({ json: async () => ({ id: 901 }) }),
  toggle = () => Promise.resolve({ json: async () => ({ favourited: true }) }),
}: {
  save?: () => Promise<unknown>;
  toggle?: () => Promise<unknown>;
} = {}) {
  mockApiRequest.mockImplementation(async (method: string, url: string) =>
    method === "GET"
      ? { json: async () => catalogDetail }
      : url === FAVOURITE_TOGGLE_URL
        ? toggle()
        : save(),
  );
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const toggleCalls = () =>
  mockApiRequest.mock.calls.filter(([, u]) => u === FAVOURITE_TOGGLE_URL);

beforeEach(() => {
  vi.clearAllMocks();
  favouriteIds.current = [];
});

afterEach(() => {
  cleanup();
});

describe("FeaturedRecipeDetailScreen — favourite heart pop", () => {
  it("unsaved preview: taps at once, pops only after the favourite lands", async () => {
    const toggle = deferred<unknown>();
    mockCatalogApi({ toggle: () => toggle.promise });
    renderComponent(<FeaturedRecipeDetailScreen />);

    fireEvent.click(await screen.findByLabelText(ADD_LABEL));

    expect(mockImpact).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toggleCalls()).toHaveLength(1));
    // Saved, favourite request in flight: nothing to celebrate yet.
    expect(mockTriggerPop).not.toHaveBeenCalled();

    toggle.resolve({ json: async () => ({ favourited: true }) });

    await waitFor(() => expect(mockTriggerPop).toHaveBeenCalledTimes(1));
  });

  it("unsaved preview: a failed save never pops", async () => {
    mockCatalogApi({ save: () => Promise.reject(new Error("500: boom")) });
    renderComponent(<FeaturedRecipeDetailScreen />);

    fireEvent.click(await screen.findByLabelText(ADD_LABEL));

    await waitFor(() =>
      expect(
        mockApiRequest.mock.calls.some(([m]) => m === "POST"),
      ).toBeTruthy(),
    );
    // Let the rejected save settle before asserting the absence.
    await new Promise((r) => setTimeout(r, 0));
    expect(toggleCalls()).toEqual([]);
    expect(mockTriggerPop).not.toHaveBeenCalled();
  });

  it("unsaved preview: a failed favourite never pops", async () => {
    let rejected = false;
    mockCatalogApi({
      toggle: () => {
        rejected = true;
        return Promise.reject(new Error("500: boom"));
      },
    });
    renderComponent(<FeaturedRecipeDetailScreen />);

    fireEvent.click(await screen.findByLabelText(ADD_LABEL));

    await waitFor(() => expect(rejected).toBe(true));
    await new Promise((r) => setTimeout(r, 0));
    expect(mockTriggerPop).not.toHaveBeenCalled();
  });

  it("saved copy: pops at tap, before the toggle resolves, with no tap haptic", async () => {
    const toggle = deferred<unknown>();
    mockCatalogApi({ toggle: () => toggle.promise });
    renderComponent(<FeaturedRecipeDetailScreen />);
    fireEvent.click(await screen.findByLabelText(SAVE_LABEL));
    await screen.findByText("Saved · View recipe");

    fireEvent.click(screen.getByLabelText(ADD_LABEL));

    expect(mockTriggerPop).toHaveBeenCalledTimes(1);
    expect(mockImpact).not.toHaveBeenCalled();
    toggle.resolve({ json: async () => ({ favourited: true }) });
  });

  it("saved copy: unfavouriting taps without a pop", async () => {
    favouriteIds.current = [{ recipeId: 901, recipeType: "mealPlan" }];
    mockCatalogApi();
    renderComponent(<FeaturedRecipeDetailScreen />);
    fireEvent.click(await screen.findByLabelText(SAVE_LABEL));

    fireEvent.click(await screen.findByLabelText(REMOVE_LABEL));

    expect(mockImpact).toHaveBeenCalledTimes(1);
    expect(mockTriggerPop).not.toHaveBeenCalled();
  });
});
