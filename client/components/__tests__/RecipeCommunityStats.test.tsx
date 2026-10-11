// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { RecipeCommunityStats } from "../RecipeCommunityStats";
import { ApiError } from "@/lib/api-error";

const { mockApiRequest, mockNavigate, mockSelection } = vi.hoisted(() => ({
  mockApiRequest: vi.fn(),
  mockNavigate: vi.fn(),
  mockSelection: vi.fn(),
}));

vi.mock("@/lib/query-client", () => ({
  apiRequest: (...args: unknown[]) => mockApiRequest(...args),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: mockNavigate }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    notification: vi.fn(),
    selection: mockSelection,
    disabled: false,
  }),
}));

const ok = (body: unknown) => ({ ok: true, json: () => Promise.resolve(body) });

function renderStats(onRemix = vi.fn()) {
  renderComponent(
    <RecipeCommunityStats recipeId={7} recipeTitle="Chili" onRemix={onRemix} />,
  );
  return onRemix;
}

describe("RecipeCommunityStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders nothing when the recipe is not public (404)", async () => {
    mockApiRequest.mockRejectedValue(
      new ApiError("404: Recipe not found", "NOT_FOUND", 404),
    );
    renderStats();
    await waitFor(() =>
      expect(screen.queryByLabelText("Loading community stats")).toBeNull(),
    );
    expect(screen.queryByText("Community")).toBeNull();
  });

  it("turns zero counts into invitations; the variants row remixes", async () => {
    mockApiRequest.mockResolvedValue(
      ok({
        triedCount: 0,
        triedByMe: false,
        favouritedCount: 0,
        variantCount: 0,
      }),
    );
    const onRemix = renderStats();
    await screen.findByText("Community");
    expect(screen.getByText("Be the first")).toBeTruthy();
    expect(screen.getByText("Not yet")).toBeTruthy();
    expect(screen.getByText("Remix it")).toBeTruthy();

    fireEvent.click(
      screen.getByLabelText("Community variants, none yet. Remix this recipe"),
    );
    expect(onRemix).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("shows counts; the variants row opens the list", async () => {
    mockApiRequest.mockResolvedValue(
      ok({
        triedCount: 12,
        triedByMe: true,
        favouritedCount: 1,
        variantCount: 3,
      }),
    );
    const onRemix = renderStats();
    await screen.findByText("Community");
    expect(screen.getByText("12 people")).toBeTruthy();
    expect(screen.getByText("1 person")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Community variants, 3"));
    expect(mockSelection).toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith("RecipeVariants", {
      recipeId: 7,
      title: "Chili",
    });
    expect(onRemix).not.toHaveBeenCalled();
  });
});
