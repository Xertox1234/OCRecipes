// @vitest-environment jsdom
import React from "react";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { SimpleEntrySheet } from "../SimpleEntrySheet";

const mockParseFoodText = vi.fn();
const mockCreateRecipe = vi.fn();
const mockAddItem = vi.fn();
const mockTranscribeMutate = vi.fn();
const mockStartRecording = vi.fn();
const mockStopRecording = vi.fn();

let mockIsRecording = false;
let mockTranscribeIsPending = false;
let mockHasVoiceLogging = true;

vi.mock("@/hooks/useFoodParse", () => ({
  useParseFoodText: () => ({
    mutateAsync: mockParseFoodText,
  }),
  useTranscribeFood: () => ({
    mutate: mockTranscribeMutate,
    isPending: mockTranscribeIsPending,
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

vi.mock("@/hooks/useVoiceRecording", () => ({
  useVoiceRecording: () => ({
    isRecording: mockIsRecording,
    startRecording: mockStartRecording,
    stopRecording: mockStopRecording,
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
    mockIsRecording = false;
    mockTranscribeIsPending = false;
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
      expect(screen.getByLabelText("Start voice recording")).toBeDefined();
    });

    it("hides mic button for free users", () => {
      mockHasVoiceLogging = false;
      renderComponent(<SimpleEntrySheet {...defaultProps} />);
      expect(screen.queryByLabelText("Start voice recording")).toBeNull();
    });

    it("calls startRecording on mic press when idle", () => {
      mockStartRecording.mockResolvedValue(undefined);
      renderComponent(<SimpleEntrySheet {...defaultProps} />);
      fireEvent.click(screen.getByLabelText("Start voice recording"));
      expect(mockStartRecording).toHaveBeenCalledOnce();
    });

    it("calls stopRecording and transcribe on mic press when recording", async () => {
      mockIsRecording = true;
      mockStopRecording.mockResolvedValue("file:///audio.m4a");
      renderComponent(<SimpleEntrySheet {...defaultProps} />);
      fireEvent.click(screen.getByLabelText("Stop recording"));

      await waitFor(() => {
        expect(mockStopRecording).toHaveBeenCalledOnce();
      });

      await waitFor(() => {
        expect(mockTranscribeMutate).toHaveBeenCalledWith(
          "file:///audio.m4a",
          expect.objectContaining({
            onSuccess: expect.any(Function),
            onError: expect.any(Function),
          }),
        );
      });
    });

    it("fills dish name on successful transcription", async () => {
      mockIsRecording = true;
      mockStopRecording.mockResolvedValue("file:///audio.m4a");
      mockTranscribeMutate.mockImplementation(
        (
          _uri: string,
          opts: { onSuccess: (data: { transcription: string }) => void },
        ) => {
          opts.onSuccess({ transcription: "grilled salmon" });
        },
      );

      renderComponent(<SimpleEntrySheet {...defaultProps} />);
      fireEvent.click(screen.getByLabelText("Stop recording"));

      await waitFor(() => {
        const input = screen.getByLabelText("Dish name") as HTMLInputElement;
        expect(input.value).toBe("grilled salmon");
      });
    });

    it("shows error when transcription fails", async () => {
      mockIsRecording = true;
      mockStopRecording.mockResolvedValue("file:///audio.m4a");
      mockTranscribeMutate.mockImplementation(
        (_uri: string, opts: { onError: () => void }) => {
          opts.onError();
        },
      );

      renderComponent(<SimpleEntrySheet {...defaultProps} />);
      fireEvent.click(screen.getByLabelText("Stop recording"));

      await waitFor(() => {
        expect(
          screen.getByText("Couldn't transcribe voice. Please try again."),
        ).toBeDefined();
      });
    });

    it("shows error when microphone permission is denied", async () => {
      mockStartRecording.mockRejectedValue(new Error("Permission denied"));
      renderComponent(<SimpleEntrySheet {...defaultProps} />);
      fireEvent.click(screen.getByLabelText("Start voice recording"));

      await waitFor(() => {
        expect(
          screen.getByText("Microphone access is needed for voice input."),
        ).toBeDefined();
      });
    });
  });
});
