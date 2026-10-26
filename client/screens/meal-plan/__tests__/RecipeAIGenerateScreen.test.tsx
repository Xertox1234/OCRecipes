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

describe("RecipeAIGenerateScreen — prompt field label", () => {
  it('names the prompt "What should we make?" and keeps only an example as the placeholder', () => {
    renderScreen();
    expect(
      screen.getAllByTestId("focus-field-label").map((l) => l.textContent),
    ).toContain("What should we make?");
    const input = screen.getByLabelText("What should we make?");
    fireEvent.focus(input);
    const placeholder = input.getAttribute("placeholder") ?? "";
    expect(placeholder).toMatch(/^e\.g\. /);
    expect(placeholder).not.toMatch(/what do you want/i);
  });
});

// Form-fields spec §5.1: Generate is pressable with a short prompt; pressing
// it says why and moves focus to the prompt. No message while typing; one on
// leaving a prompt that has text.
describe("RecipeAIGenerateScreen — validation timing", () => {
  const MESSAGE = "Describe the recipe in at least 3 characters.";

  it("Generate is pressable with an empty prompt, and flags + focuses it", () => {
    renderScreen();
    const generate = screen.getByLabelText("Generate Recipe");
    expect(generate.getAttribute("aria-disabled")).not.toBe("true");

    fireEvent.click(generate);

    expect(screen.getByText(MESSAGE)).toBeTruthy();
    expect(document.activeElement).toBe(
      screen.getByLabelText("What should we make?"),
    );
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("shows nothing while a short prompt is typed, and the message on leaving", () => {
    renderScreen();
    const input = screen.getByLabelText("What should we make?");
    fireEvent.change(input, { target: { value: "ab" } });
    expect(screen.queryByText(MESSAGE)).toBeNull();
    fireEvent.blur(input);
    expect(screen.getByText(MESSAGE)).toBeTruthy();
    fireEvent.change(input, { target: { value: "abc" } });
    expect(screen.queryByText(MESSAGE)).toBeNull();
  });
});
