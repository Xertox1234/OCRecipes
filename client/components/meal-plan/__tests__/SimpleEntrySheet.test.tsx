// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { SimpleEntrySheet } from "../SimpleEntrySheet";

const mockParseFoodText = vi.fn();
const mockCreateRecipe = vi.fn();
const mockAddItem = vi.fn();
const mockStartListening = vi.fn();
const mockStopListening = vi.fn();

let mockIsListening = false;
let mockTranscript = "";
let mockIsFinal = false;
let mockVolume = -2;
let mockSpeechError: string | null = null;
let mockHasVoiceLogging = true;

vi.mock("@/hooks/useFoodParse", () => ({
  useParseFoodText: () => ({
    mutateAsync: mockParseFoodText,
  }),
}));

vi.mock("@/hooks/useMealPlanRecipes", () => ({
  useCreateMealPlanRecipe: () => ({
    mutateAsync: mockCreateRecipe,
  }),
}));

vi.mock("@/hooks/useMealPlan", () => ({
  useAddMealPlanItem: () => ({
    mutateAsync: mockAddItem,
  }),
  invalidateMealPlanItems: vi.fn(),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    selection: vi.fn(),
    notification: vi.fn(),
  }),
}));

vi.mock("@/hooks/useSpeechToText", () => ({
  useSpeechToText: () => ({
    isListening: mockIsListening,
    transcript: mockTranscript,
    isFinal: mockIsFinal,
    volume: mockVolume,
    error: mockSpeechError,
    startListening: mockStartListening,
    stopListening: mockStopListening,
  }),
}));

vi.mock("@/hooks/usePremiumFeatures", () => ({
  usePremiumFeature: () => mockHasVoiceLogging,
}));

describe("SimpleEntrySheet", () => {
  const defaultProps = {
    mealType: "lunch" as const,
    plannedDate: "2025-06-01",
    onDismiss: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsListening = false;
    mockTranscript = "";
    mockIsFinal = false;
    mockVolume = -2;
    mockSpeechError = null;
    mockHasVoiceLogging = true;
  });

  it("renders header with meal label", () => {
    renderComponent(<SimpleEntrySheet {...defaultProps} />);
    expect(screen.getByText("Quick add to Lunch")).toBeDefined();
  });

  it("renders dish name input", () => {
    renderComponent(<SimpleEntrySheet {...defaultProps} />);
    expect(screen.getByLabelText("Dish name")).toBeDefined();
  });

  it("renders servings stepper", () => {
    renderComponent(<SimpleEntrySheet {...defaultProps} />);
    expect(screen.getByText("Servings")).toBeDefined();
    expect(screen.getByLabelText("Decrease servings")).toBeDefined();
    expect(screen.getByLabelText("Increase servings")).toBeDefined();
  });

  it("renders Add button", () => {
    renderComponent(<SimpleEntrySheet {...defaultProps} />);
    expect(screen.getByText("Add")).toBeDefined();
  });

  it("increments servings on plus press", () => {
    renderComponent(<SimpleEntrySheet {...defaultProps} />);
    const increaseBtn = screen.getByLabelText("Increase servings");
    fireEvent.click(increaseBtn);
    expect(screen.getByText("2")).toBeDefined();
  });

  it("decrements servings on minus press", () => {
    renderComponent(<SimpleEntrySheet {...defaultProps} />);
    // First increase to 2
    fireEvent.click(screen.getByLabelText("Increase servings"));
    // Then decrease back to 1
    fireEvent.click(screen.getByLabelText("Decrease servings"));
    expect(screen.getByText("1")).toBeDefined();
  });

  it("disables decrease button at minimum (1)", () => {
    renderComponent(<SimpleEntrySheet {...defaultProps} />);
    const decreaseBtn = screen.getByLabelText("Decrease servings");
    expect(decreaseBtn).toHaveProperty("disabled", true);
  });

  it("calls onDismiss when Done is pressed", () => {
    renderComponent(<SimpleEntrySheet {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(defaultProps.onDismiss).toHaveBeenCalledTimes(1);
  });

  it("calls parse, create recipe, and add item on submit", async () => {
    mockParseFoodText.mockResolvedValue({
      items: [
        {
          name: "chicken stir fry",
          quantity: 1,
          calories: 350,
          protein: 30,
          carbs: 20,
          fat: 12,
        },
      ],
    });
    mockCreateRecipe.mockResolvedValue({ id: 42 });
    mockAddItem.mockResolvedValue({ id: 1 });

    renderComponent(<SimpleEntrySheet {...defaultProps} />);

    const input = screen.getByLabelText("Dish name");
    fireEvent.change(input, { target: { value: "chicken stir fry" } });

    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => {
      expect(mockParseFoodText).toHaveBeenCalledWith("chicken stir fry");
    });

    await waitFor(() => {
      expect(mockCreateRecipe).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "chicken stir fry",
          sourceType: "quick_entry",
          caloriesPerServing: "350",
          proteinPerServing: "30",
          carbsPerServing: "20",
          fatPerServing: "12",
        }),
      );
    });

    await waitFor(() => {
      expect(mockAddItem).toHaveBeenCalledWith(
        expect.objectContaining({
          recipeId: 42,
          plannedDate: "2025-06-01",
          mealType: "lunch",
          servings: 1,
        }),
      );
    });
  });

  it("shows error when parse returns empty items", async () => {
    mockParseFoodText.mockResolvedValue({ items: [] });

    renderComponent(<SimpleEntrySheet {...defaultProps} />);

    const input = screen.getByLabelText("Dish name");
    fireEvent.change(input, { target: { value: "asdfghjkl" } });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Couldn't estimate nutrition. Try a simpler description.",
        ),
      ).toBeDefined();
    });
  });

  it("shows error when parse throws", async () => {
    mockParseFoodText.mockRejectedValue(new Error("API error"));

    renderComponent(<SimpleEntrySheet {...defaultProps} />);

    const input = screen.getByLabelText("Dish name");
    fireEvent.change(input, { target: { value: "something" } });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => {
      expect(
        screen.getByText(
          "Couldn't estimate nutrition. Try a simpler description.",
        ),
      ).toBeDefined();
    });
  });

  it("sums nutrition across multiple parsed items", async () => {
    mockParseFoodText.mockResolvedValue({
      items: [
        {
          name: "eggs",
          quantity: 2,
          calories: 70,
          protein: 6,
          carbs: 1,
          fat: 5,
        },
        {
          name: "toast",
          quantity: 1,
          calories: 120,
          protein: 4,
          carbs: 22,
          fat: 2,
        },
      ],
    });
    mockCreateRecipe.mockResolvedValue({ id: 10 });
    mockAddItem.mockResolvedValue({ id: 1 });

    renderComponent(<SimpleEntrySheet {...defaultProps} />);

    const input = screen.getByLabelText("Dish name");
    fireEvent.change(input, { target: { value: "eggs and toast" } });
    fireEvent.click(screen.getByText("Add"));

    await waitFor(() => {
      // Sum nutrition as-is (quantity already accounted for in lookup)
      // 70 + 120 = 190 cal, 6 + 4 = 10 protein, etc.
      expect(mockCreateRecipe).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "eggs and toast",
          caloriesPerServing: "190",
          proteinPerServing: "10",
          carbsPerServing: "23",
          fatPerServing: "7",
        }),
      );
    });
  });

  describe("voice dictation", () => {
    it("renders mic button for premium users", () => {
      mockHasVoiceLogging = true;
      renderComponent(<SimpleEntrySheet {...defaultProps} />);
      expect(screen.getByLabelText("Start voice input")).toBeDefined();
    });

    it("hides mic button for free users", () => {
      mockHasVoiceLogging = false;
      renderComponent(<SimpleEntrySheet {...defaultProps} />);
      expect(screen.queryByLabelText("Start voice input")).toBeNull();
    });

    it("calls startListening on mic press when idle", () => {
      renderComponent(<SimpleEntrySheet {...defaultProps} />);
      fireEvent.click(screen.getByLabelText("Start voice input"));
      expect(mockStartListening).toHaveBeenCalledOnce();
    });

    it("calls stopListening on mic press when listening", () => {
      mockIsListening = true;
      renderComponent(<SimpleEntrySheet {...defaultProps} />);
      fireEvent.click(screen.getByLabelText("Listening, tap to stop"));
      expect(mockStopListening).toHaveBeenCalledOnce();
    });

    it("shows error when speech recognition has an error", async () => {
      // Set error before mount — mealType effect runs first (clears error),
      // then speechError effect runs (sets error)
      mockSpeechError =
        "Microphone or speech recognition permission not granted.";
      renderComponent(<SimpleEntrySheet {...defaultProps} />);

      await waitFor(() => {
        expect(
          screen.getByText(
            "Microphone or speech recognition permission not granted.",
          ),
        ).toBeDefined();
      });
    });
  });
});
