// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, render, waitFor } from "@testing-library/react";

import { createQueryWrapper } from "../../../../test/utils/query-wrapper";
import {
  setHeldRecipeDraft,
  setPendingGeneration,
  type HeldRecipeDraft,
} from "@/hooks/useGeneratedRecipeNotices";
import type { ImportedRecipeData } from "@shared/types/recipe-import";
import RecipeAIGenerateScreen from "../RecipeAIGenerateScreen";

const { mockGoBack, mockReplace, mockRouteParams, mockStart, mockOpen } =
  vi.hoisted(() => ({
    mockGoBack: vi.fn(),
    mockReplace: vi.fn(),
    mockRouteParams: vi.fn(),
    mockStart: vi.fn(),
    mockOpen: vi.fn(),
  }));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    replace: mockReplace,
    navigate: vi.fn(),
  }),
  useRoute: () => ({ params: mockRouteParams() }),
}));
vi.mock("@/hooks/useRecipeGenerate", () => ({
  useRecipeGenerate: () => ({ start: mockStart }),
}));
vi.mock("@/navigation/openRecipeCreate", () => ({
  openRecipeCreate: mockOpen,
}));

const returnToMealPlan = { mealType: "dinner", plannedDate: "2026-10-20" };
const draft: HeldRecipeDraft = {
  prefill: { title: "Lemon Soup" } as unknown as ImportedRecipeData,
  returnToMealPlan,
};

function renderScreen() {
  const { queryClient, wrapper } = createQueryWrapper();
  render(<RecipeAIGenerateScreen />, { wrapper });
  return { queryClient };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRouteParams.mockReturnValue({ returnToMealPlan });
});

// Generate hands the prompt to the background hook and returns to the plan
// (spec §5b); the draft comes back as a toast, or as the banner here.
describe("RecipeAIGenerateScreen — Generate lets go", () => {
  it("starts the draft with the trimmed prompt and returnToMealPlan, then goes back", () => {
    renderScreen();
    fireEvent.click(screen.getByLabelText("Quick dinner"));

    fireEvent.click(screen.getByLabelText("Generate Recipe"));

    expect(mockStart).toHaveBeenCalledExactlyOnceWith(
      "Quick dinner",
      returnToMealPlan,
    );
    expect(mockGoBack).toHaveBeenCalledOnce();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("ignores a second tap in the same frame", () => {
    renderScreen();
    fireEvent.click(screen.getByLabelText("Quick dinner"));

    fireEvent.click(screen.getByLabelText("Generate Recipe"));
    fireEvent.click(screen.getByLabelText("Generate Recipe"));

    expect(mockStart).toHaveBeenCalledOnce();
  });

  it("still refuses a prompt under three characters", () => {
    renderScreen();

    fireEvent.click(screen.getByLabelText("Generate Recipe"));

    expect(mockStart).not.toHaveBeenCalled();
    expect(mockGoBack).not.toHaveBeenCalled();
  });

  it("disables Generate with the pending caption while a draft is in flight", async () => {
    const { queryClient, wrapper } = createQueryWrapper();
    setPendingGeneration(queryClient, "mealPlan", true);

    render(<RecipeAIGenerateScreen />, { wrapper });

    await waitFor(() =>
      expect(screen.queryByLabelText("A recipe is on its way")).not.toBeNull(),
    );
    expect(
      screen
        .getByLabelText("A recipe is on its way")
        .getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(screen.getByLabelText("Quick dinner"));
    fireEvent.click(screen.getByLabelText("A recipe is on its way"));
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("shows no banner and no error copy by default", () => {
    renderScreen();

    expect(screen.queryByText("Your draft is ready")).toBeNull();
    expect(screen.queryByText(/Something went wrong/)).toBeNull();
  });

  it("shows the 'Your draft is ready' banner with a Review button while a draft is held", async () => {
    const { queryClient, wrapper } = createQueryWrapper();
    setHeldRecipeDraft(queryClient, draft);

    render(<RecipeAIGenerateScreen />, { wrapper });

    await waitFor(() =>
      expect(screen.queryByText("Your draft is ready")).not.toBeNull(),
    );
    fireEvent.click(screen.getByLabelText("Review"));
    expect(mockOpen).toHaveBeenCalledExactlyOnceWith(queryClient, draft);
  });
});
