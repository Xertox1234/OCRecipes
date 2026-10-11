// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import RecipeVariantsScreen from "../RecipeVariantsScreen";

const { mockApiRequest, mockPush } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  mockPush: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ push: mockPush }),
  useRoute: () => ({ params: { recipeId: 7, title: "Chili" } }),
}));

vi.mock("@/hooks/useHeaderContentInset", () => ({
  useHeaderContentInset: () => 0,
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    selection: vi.fn(),
    notification: vi.fn(),
  }),
}));

const ok = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) });

describe("RecipeVariantsScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists public remixes and opens one as a new detail screen", async () => {
    mockApiRequest.mockResolvedValue(
      ok({
        variants: [
          {
            id: 9,
            title: "Spicier Chili",
            imageUrl: null,
            createdAt: "2026-10-01T00:00:00.000Z",
          },
        ],
      }),
    );
    renderComponent(<RecipeVariantsScreen />);
    fireEvent.click(await screen.findByText("Spicier Chili"));
    expect(mockApiRequest).toHaveBeenCalledWith(
      "GET",
      "/api/recipes/7/variants",
    );
    expect(mockPush).toHaveBeenCalledWith("FeaturedRecipeDetail", {
      recipeId: 9,
      recipeType: "community",
    });
  });

  it("shows the empty state when there are no remixes", async () => {
    mockApiRequest.mockResolvedValue(ok({ variants: [] }));
    renderComponent(<RecipeVariantsScreen />);
    expect(await screen.findByText("No community variants yet.")).toBeTruthy();
    expect(screen.getByText("Be the first to remix Chili.")).toBeTruthy();
  });

  it("shows an error with a retry instead of the empty state", async () => {
    mockApiRequest.mockRejectedValueOnce(new Error("network"));
    renderComponent(<RecipeVariantsScreen />);
    expect(
      await screen.findByText("Couldn't load community variants."),
    ).toBeTruthy();
    expect(screen.queryByText("No community variants yet.")).toBeNull();

    mockApiRequest.mockResolvedValue(ok({ variants: [] }));
    fireEvent.click(screen.getByText("Try again"));
    expect(await screen.findByText("No community variants yet.")).toBeTruthy();
  });
});
