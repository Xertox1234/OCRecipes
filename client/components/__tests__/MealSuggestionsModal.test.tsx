// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { MealSuggestionsModal } from "../MealSuggestionsModal";
import { ApiError } from "@/lib/api-error";

const mockMutate = vi.fn();
const mockReset = vi.fn();

const { mockUseMealSuggestions } = vi.hoisted(() => ({
  mockUseMealSuggestions: vi.fn(),
}));

vi.mock("@/hooks/useMealSuggestions", () => ({
  useMealSuggestions: () => mockUseMealSuggestions(),
}));

vi.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({ impact: vi.fn(), notification: vi.fn() }),
}));

const baseSuggestion = {
  title: "Grilled Salmon Bowl",
  description: "A protein-rich meal with vegetables",
  calories: 450,
  prepTimeMinutes: 20,
  difficulty: "easy" as const,
  reasoning: "Fits your protein goal",
  proteinGrams: 35,
  carbsGrams: 40,
  fatGrams: 15,
  ingredients: ["salmon", "rice", "broccoli"],
  instructions: ["Cook rice", "Grill salmon", "Steam broccoli"],
};

describe("MealSuggestionsModal", () => {
  const defaultProps = {
    visible: true,
    date: "2024-01-15",
    mealType: "lunch",
    onClose: vi.fn(),
    onSelectSuggestion: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockUseMealSuggestions.mockReturnValue({
      mutate: mockMutate,
      reset: mockReset,
      isPending: false,
      isError: false,
      data: null,
      error: null,
    });
  });

  it("renders header with capitalized meal type", () => {
    renderComponent(<MealSuggestionsModal {...defaultProps} />);
    expect(screen.getByText("Lunch Suggestions")).toBeDefined();
  });

  it("renders close button", () => {
    renderComponent(<MealSuggestionsModal {...defaultProps} />);
    expect(screen.getByLabelText("Close suggestions")).toBeDefined();
  });

  it("shows skeletons when loading", () => {
    mockUseMealSuggestions.mockReturnValue({
      mutate: mockMutate,
      reset: mockReset,
      isPending: true,
      isError: false,
      data: null,
      error: null,
    });
    renderComponent(<MealSuggestionsModal {...defaultProps} />);
    // No suggestion titles should appear, but modal header should
    expect(screen.getByText("Lunch Suggestions")).toBeDefined();
    expect(screen.queryByText("Grilled Salmon Bowl")).toBeNull();
  });

  it("renders suggestion cards with data", () => {
    mockUseMealSuggestions.mockReturnValue({
      mutate: mockMutate,
      reset: mockReset,
      isPending: false,
      isError: false,
      data: {
        suggestions: [baseSuggestion],
        remainingToday: 5,
      },
      error: null,
    });
    renderComponent(<MealSuggestionsModal {...defaultProps} />);
    expect(screen.getByText("Grilled Salmon Bowl")).toBeDefined();
    expect(screen.getByText("450 cal")).toBeDefined();
    expect(screen.getByText("20 min")).toBeDefined();
    expect(screen.getByText("easy")).toBeDefined();
  });

  it("renders Pick button for each suggestion", () => {
    mockUseMealSuggestions.mockReturnValue({
      mutate: mockMutate,
      reset: mockReset,
      isPending: false,
      isError: false,
      data: {
        suggestions: [baseSuggestion],
        remainingToday: 5,
      },
      error: null,
    });
    renderComponent(<MealSuggestionsModal {...defaultProps} />);
    expect(screen.getByLabelText("Pick Grilled Salmon Bowl")).toBeDefined();
  });

  it("calls onSelectSuggestion when Pick is pressed", () => {
    const onSelectSuggestion = vi.fn();
    mockUseMealSuggestions.mockReturnValue({
      mutate: mockMutate,
      reset: mockReset,
      isPending: false,
      isError: false,
      data: {
        suggestions: [baseSuggestion],
        remainingToday: 5,
      },
      error: null,
    });
    renderComponent(
      <MealSuggestionsModal
        {...defaultProps}
        onSelectSuggestion={onSelectSuggestion}
      />,
    );
    fireEvent.click(screen.getByLabelText("Pick Grilled Salmon Bowl"));
    expect(onSelectSuggestion).toHaveBeenCalledWith(baseSuggestion);
  });

  it("shows Suggest More button when data exists", () => {
    mockUseMealSuggestions.mockReturnValue({
      mutate: mockMutate,
      reset: mockReset,
      isPending: false,
      isError: false,
      data: {
        suggestions: [baseSuggestion],
        remainingToday: 5,
      },
      error: null,
    });
    renderComponent(<MealSuggestionsModal {...defaultProps} />);
    expect(screen.getByText("Suggest More")).toBeDefined();
    expect(screen.getByText("5 suggestions remaining today")).toBeDefined();
  });

  it("shows error state with Try Again button", () => {
    mockUseMealSuggestions.mockReturnValue({
      mutate: mockMutate,
      reset: mockReset,
      isPending: false,
      isError: true,
      data: null,
      error: new Error("Something went wrong"),
    });
    renderComponent(<MealSuggestionsModal {...defaultProps} />);
    expect(screen.getByText("Something went wrong")).toBeDefined();
    expect(screen.getByLabelText("Try again")).toBeDefined();
  });

  it("shows daily limit reached message", () => {
    const limitError = new ApiError("Daily limit", "DAILY_LIMIT_REACHED");
    mockUseMealSuggestions.mockReturnValue({
      mutate: mockMutate,
      reset: mockReset,
      isPending: false,
      isError: true,
      data: null,
      error: limitError,
    });
    renderComponent(<MealSuggestionsModal {...defaultProps} />);
    expect(
      screen.getByText("Daily suggestion limit reached. Try again tomorrow."),
    ).toBeDefined();
  });

  it("does not render content when not visible", () => {
    const { container } = renderComponent(
      <MealSuggestionsModal {...defaultProps} visible={false} />,
    );
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });
});
