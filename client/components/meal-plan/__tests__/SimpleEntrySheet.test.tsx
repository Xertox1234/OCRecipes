// @vitest-environment jsdom
import React from "react";
import { act, screen, fireEvent, waitFor } from "@testing-library/react";
import { useBottomSheet } from "@gorhom/bottom-sheet";
import { renderComponent } from "../../../../test/utils/render-component";
import { SimpleEntrySheetContent } from "../SimpleEntrySheet";
import { ApiError } from "@/lib/api-error";
import * as Haptics from "expo-haptics";
import { AccessibilityInfo } from "react-native";

const mockParseFoodText = vi.fn();
const mockCreateRecipe = vi.fn();
const mockAddItem = vi.fn();
const mockStartListening = vi.fn();
const mockStopListening = vi.fn();
const mockNotification = vi.fn();
const mockToastSuccess = vi.fn();
const mockPictureRefresh = vi.fn();

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

const { mockConfirmPick } = vi.hoisted(() => ({
  mockConfirmPick: vi.fn(async () => ({
    proceed: true,
    note: null as string | null,
  })),
}));
vi.mock("@/hooks/useConfirmPlanPick", () => ({
  useConfirmPlanPick: () => mockConfirmPick,
}));

vi.mock("@/hooks/useMealPlan", () => ({
  useAddMealPlanItem: () => ({
    mutateAsync: mockAddItem,
  }),
  invalidateMealPlanItems: vi.fn(),
  refreshMealPlanItemsForPendingPicture: (...args: unknown[]) =>
    mockPictureRefresh(...args),
}));

vi.mock("@/hooks/useHaptics", () => ({
  useHaptics: () => ({
    impact: vi.fn(),
    selection: vi.fn(),
    notification: (...args: unknown[]) => mockNotification(...args),
  }),
}));

vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: vi.fn(),
    info: vi.fn(),
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

vi.mock("@/components/UpgradeModal", () => ({
  UpgradeModal: ({ visible }: { visible: boolean }) =>
    visible ? "UPGRADE_MODAL_SHOWN" : null,
}));

const ADD_ERROR = "Couldn't add it to your plan. Please try again.";

const PARSE_ERROR = "Couldn't estimate nutrition. Try a simpler description.";

function food(overrides: Record<string, unknown> = {}) {
  return {
    name: "soup",
    quantity: 1,
    unit: "bowl",
    calories: 100,
    protein: 5,
    carbs: 10,
    fat: 3,
    servingSize: "1 bowl (250 g)",
    ...overrides,
  };
}

const BACON_AND_EGGS = {
  items: [
    food({
      name: "bacon",
      quantity: 3,
      unit: "slices",
      calories: 129,
      protein: 9,
      carbs: 0,
      fat: 10,
      servingSize: "3 slices (24 g)",
    }),
    food({
      name: "egg",
      quantity: 2,
      unit: "large",
      calories: 143,
      protein: 13,
      carbs: 1,
      fat: 10,
      servingSize: "2 large (100 g)",
    }),
  ],
};

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

  function typeDish(name: string) {
    fireEvent.change(screen.getByLabelText("Dish name"), {
      target: { value: name },
    });
  }

  /** Step 1 → step 2: type a dish, estimate, wait for the review. */
  async function estimate(name: string) {
    typeDish(name);
    fireEvent.click(screen.getByText("Estimate"));
    await waitFor(() => {
      expect(screen.getByText("Add to Lunch")).toBeDefined();
    });
  }

  function pressAdd() {
    fireEvent.click(screen.getByText("Add to Lunch"));
  }

  async function submitDish(name: string) {
    await estimate(name);
    pressAdd();
  }

  it("renders header with meal label", () => {
    renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
    expect(screen.getByText("Quick add to Lunch")).toBeDefined();
  });

  it("renders dish name input", () => {
    renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
    expect(screen.getByLabelText("Dish name")).toBeDefined();
  });

  it("starts with an Estimate button and no review", () => {
    renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
    expect(screen.getByText("Estimate")).toBeDefined();
    expect(screen.queryByText("Add to Lunch")).toBeNull();
    expect(screen.queryByText("Servings on the plan")).toBeNull();
  });

  it("calls onDismiss when Done is pressed", () => {
    renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
    fireEvent.click(screen.getByLabelText("Close"));
    expect(defaultProps.onDismiss).toHaveBeenCalledTimes(1);
  });

  it("passes accessibilityViewIsModal on the sheet's content root (traps VoiceOver focus behind the sheet; jsdom cannot verify the native trap itself, only that the prop is passed)", () => {
    renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
    expect(
      screen.getByText("Quick add to Lunch").closest('[aria-modal="true"]'),
    ).not.toBeNull();
  });

  describe("review step", () => {
    it("shows each food the estimate found, with its amount and the total", async () => {
      mockParseFoodText.mockResolvedValue(BACON_AND_EGGS);
      renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
      await estimate("bacon and eggs");

      expect(mockParseFoodText).toHaveBeenCalledWith("bacon and eggs");
      expect(screen.getByText("bacon")).toBeDefined();
      expect(screen.getByText("egg")).toBeDefined();
      expect(screen.getByText("3 slices · 24 g · 129 kcal")).toBeDefined();
      expect(screen.getByTestId("total-calories").textContent).toBe("272");
      // Nothing is saved until Add.
      expect(mockCreateRecipe).not.toHaveBeenCalled();
    });

    it("keeps the review inside the sheet's scroll container, with Add outside it", async () => {
      mockParseFoodText.mockResolvedValue(BACON_AND_EGGS);
      renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
      await estimate("bacon and eggs");

      const scroll = screen.getByTestId("simple-entry-review-scroll");
      expect(scroll.contains(screen.getByText("egg"))).toBe(true);
      expect(scroll.contains(screen.getByText("Add to Lunch"))).toBe(false);
    });

    it("changing an amount changes the total and what is saved", async () => {
      mockParseFoodText.mockResolvedValue(BACON_AND_EGGS);
      mockCreateRecipe.mockResolvedValue({ id: 42 });
      mockAddItem.mockResolvedValue({ id: 1 });
      renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
      await estimate("bacon and eggs");

      fireEvent.click(screen.getByLabelText("More bacon"));
      // 4 slices: 129 * 4/3 = 172, plus 143.
      expect(screen.getByText("4 slices · 32 g · 172 kcal")).toBeDefined();
      expect(screen.getByTestId("total-calories").textContent).toBe("315");

      pressAdd();
      await waitFor(() => {
        expect(mockCreateRecipe).toHaveBeenCalledWith(
          expect.objectContaining({
            title: "bacon and eggs",
            sourceType: "quick_entry",
            caloriesPerServing: "315",
            proteinPerServing: "25",
            carbsPerServing: "1",
            fatPerServing: "23",
            servings: 1,
          }),
        );
      });
    });

    it("stepping a food below its smallest amount removes it", async () => {
      mockParseFoodText.mockResolvedValue({
        items: [food({ name: "soup" }), food({ name: "bread", unit: "slice" })],
      });
      renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
      await estimate("soup and bread");

      fireEvent.click(screen.getByLabelText("Remove bread"));
      expect(screen.queryByText("bread")).toBeNull();
      expect(screen.getByTestId("total-calories").textContent).toBe("100");
    });

    it("cannot add an entry with every food removed", async () => {
      mockParseFoodText.mockResolvedValue({
        items: [food({ unit: "serving" })],
      });
      renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
      await estimate("soup");

      fireEvent.click(screen.getByLabelText("Remove soup"));
      pressAdd();
      expect(mockCreateRecipe).not.toHaveBeenCalled();
    });

    it("says so when a food has no estimate, and leaves it out of the total", async () => {
      mockParseFoodText.mockResolvedValue({
        items: [
          food(),
          food({
            name: "mystery sauce",
            calories: null,
            protein: null,
            carbs: null,
            fat: null,
            servingSize: "1 tablespoon",
            unit: "tablespoon",
          }),
        ],
      });
      renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
      await estimate("soup with sauce");

      expect(screen.getByText("1 tablespoon · No estimate")).toBeDefined();
      expect(screen.getByTestId("total-calories").textContent).toBe("100");
    });

    it("servings on the plan steps between 1 and up, and is sent with the plan item", async () => {
      mockParseFoodText.mockResolvedValue({ items: [food()] });
      mockCreateRecipe.mockResolvedValue({ id: 42 });
      mockAddItem.mockResolvedValue({ id: 1 });
      renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
      await estimate("soup");

      expect(screen.getByText("Servings on the plan")).toBeDefined();
      expect(screen.getByLabelText("Decrease servings")).toHaveProperty(
        "disabled",
        true,
      );
      fireEvent.click(screen.getByLabelText("Increase servings"));
      fireEvent.click(screen.getByLabelText("Increase servings"));
      fireEvent.click(screen.getByLabelText("Decrease servings"));
      const announce = vi.spyOn(AccessibilityInfo, "announceForAccessibility");
      fireEvent.click(screen.getByLabelText("Increase servings"));
      fireEvent.click(screen.getByLabelText("Decrease servings"));
      expect(announce).toHaveBeenNthCalledWith(1, "3 servings on the plan");
      expect(announce).toHaveBeenNthCalledWith(2, "2 servings on the plan");
      announce.mockRestore();
      expect(screen.getByTestId("servings-value").textContent).toBe("2");

      pressAdd();
      await waitFor(() => {
        expect(mockAddItem).toHaveBeenCalledWith(
          expect.objectContaining({
            recipeId: 42,
            plannedDate: "2025-06-01",
            mealType: "lunch",
            servings: 2,
          }),
        );
      });
    });

    it("Edit goes back to the dish name, keeps it, and drops the foods", async () => {
      mockParseFoodText.mockResolvedValue({ items: [food()] });
      renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
      await estimate("soup");

      fireEvent.click(screen.getByLabelText("Edit dish name"));
      expect(screen.queryByText("Add to Lunch")).toBeNull();
      expect(
        (screen.getByLabelText("Dish name") as HTMLInputElement).value,
      ).toBe("soup");
    });
  });

  describe("review step edge cases", () => {
    it("opens the taller sheet for the review and the short one again on Edit", async () => {
      const snap = vi.spyOn(useBottomSheet(), "snapToIndex");
      mockParseFoodText.mockResolvedValue({ items: [food()] });
      renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
      await estimate("soup");
      expect(snap).toHaveBeenLastCalledWith(1);

      fireEvent.click(screen.getByLabelText("Edit dish name"));
      expect(snap).toHaveBeenLastCalledWith(0);
      snap.mockRestore();
    });

    it("drops an estimate that arrives after the sheet was closed and reopened", async () => {
      let resolveParse: (value: unknown) => void = () => {};
      mockParseFoodText.mockReturnValue(
        new Promise((resolve) => {
          resolveParse = resolve;
        }),
      );
      const { rerender } = renderComponent(
        <SimpleEntrySheetContent {...defaultProps} />,
      );
      typeDish("soup");
      fireEvent.click(screen.getByText("Estimate"));

      rerender(<SimpleEntrySheetContent {...defaultProps} mealType={null} />);
      rerender(<SimpleEntrySheetContent {...defaultProps} mealType="dinner" />);
      await act(async () => {
        resolveParse({ items: [food()] });
      });

      expect(screen.queryByText("Add to Dinner")).toBeNull();
      // The new opening is usable: its Estimate is not stuck busy.
      typeDish("stew");
      expect(screen.getByText("Estimate").closest("button")).toHaveProperty(
        "disabled",
        false,
      );
    });

    /** Taps Add with the plan request held open, then closes and reopens. */
    async function addThenReopen() {
      let settle: { resolve: (v: unknown) => void; reject: (e: Error) => void };
      mockParseFoodText.mockResolvedValue({ items: [food()] });
      mockCreateRecipe.mockResolvedValue({ id: 42, imageUrl: "pic.jpg" });
      mockAddItem.mockReturnValue(
        new Promise((resolve, reject) => {
          settle = { resolve, reject };
        }),
      );
      const { rerender } = renderComponent(
        <SimpleEntrySheetContent {...defaultProps} />,
      );
      await submitDish("soup");
      await waitFor(() => expect(mockAddItem).toHaveBeenCalled());

      rerender(<SimpleEntrySheetContent {...defaultProps} mealType={null} />);
      rerender(<SimpleEntrySheetContent {...defaultProps} mealType="dinner" />);
      return settle!;
    }

    it("keeps a failed add that arrives after a reopen out of the new opening", async () => {
      const settle = await addThenReopen();
      await act(async () => {
        settle.reject(new Error("500"));
      });

      expect(screen.queryByText(ADD_ERROR)).toBeNull();
      expect(mockNotification).not.toHaveBeenCalled();
      typeDish("stew");
      expect(screen.getByText("Estimate").closest("button")).toHaveProperty(
        "disabled",
        false,
      );
    });

    it("does not close a reopened sheet when an earlier add lands, but still confirms it", async () => {
      const settle = await addThenReopen();
      await act(async () => {
        settle.resolve({ id: 1 });
      });

      expect(defaultProps.onDismiss).not.toHaveBeenCalled();
      // The entry was saved, so the confirmation is still true.
      expect(mockToastSuccess).toHaveBeenCalledTimes(1);
    });

    it("explains a total too large to save instead of failing the add", async () => {
      mockParseFoodText.mockResolvedValue({
        items: [food({ unit: "serving", calories: 60000 })],
      });
      renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
      await estimate("a very big soup");
      pressAdd();

      expect(
        screen.getByText(
          "That's more than one entry can hold. Lower an amount and try again.",
        ),
      ).toBeDefined();
      expect(mockCreateRecipe).not.toHaveBeenCalled();
    });
  });

  describe("drinks and sides", () => {
    it("offers suggestions for the meal", async () => {
      mockParseFoodText.mockResolvedValue({ items: [food()] });
      renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
      await estimate("soup");

      expect(screen.getByText("Add a drink or side")).toBeDefined();
      expect(screen.getByLabelText("Add Side salad")).toBeDefined();
      expect(screen.getByLabelText("Add something else")).toBeDefined();
    });

    it("tapping a suggestion estimates it, adds it to the entry and drops the chip", async () => {
      mockParseFoodText.mockResolvedValueOnce({ items: [food()] });
      renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
      await estimate("soup");

      mockParseFoodText.mockResolvedValueOnce({
        items: [
          food({
            name: "Bread",
            unit: "slice",
            calories: 80,
            servingSize: "1 slice (30 g)",
          }),
        ],
      });
      fireEvent.click(screen.getByLabelText("Add Bread"));

      await waitFor(() => {
        expect(screen.getByText("1 slice · 30 g · 80 kcal")).toBeDefined();
      });
      expect(mockParseFoodText).toHaveBeenLastCalledWith("Bread");
      expect(screen.queryByLabelText("Add Bread")).toBeNull();
      expect(screen.getByTestId("total-calories").textContent).toBe("180");
    });

    it("removing an added suggestion brings its chip back", async () => {
      mockParseFoodText.mockResolvedValueOnce({ items: [food()] });
      renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
      await estimate("soup");

      // The estimate names it differently from the chip.
      mockParseFoodText.mockResolvedValueOnce({
        items: [food({ name: "garden salad", unit: "serving", calories: 40 })],
      });
      fireEvent.click(screen.getByLabelText("Add Side salad"));
      await waitFor(() => {
        expect(screen.getByText("garden salad")).toBeDefined();
      });
      expect(screen.queryByLabelText("Add Side salad")).toBeNull();

      fireEvent.click(screen.getByLabelText("Remove garden salad"));
      expect(screen.getByLabelText("Add Side salad")).toBeDefined();
    });

    it("a suggestion that can't be estimated says so and keeps the entry", async () => {
      mockParseFoodText.mockResolvedValueOnce({ items: [food()] });
      renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
      await estimate("soup");

      mockParseFoodText.mockRejectedValueOnce(new Error("500"));
      fireEvent.click(screen.getByLabelText("Add Rice"));

      await waitFor(() => {
        expect(
          screen.getByText("Couldn't estimate that one. Try another."),
        ).toBeDefined();
      });
      expect(screen.getByLabelText("More soup")).toBeDefined();
      expect(screen.getByTestId("total-calories").textContent).toBe("100");
    });

    it("something else takes typed text", async () => {
      mockParseFoodText.mockResolvedValueOnce({ items: [food()] });
      renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
      await estimate("soup");

      fireEvent.click(screen.getByLabelText("Add something else"));
      fireEvent.change(screen.getByLabelText("Drink or side"), {
        target: { value: "iced tea" },
      });
      mockParseFoodText.mockResolvedValueOnce({
        items: [food({ name: "iced tea", unit: "glass", calories: 90 })],
      });
      fireEvent.click(screen.getByLabelText("Add drink or side"));

      await waitFor(() => {
        expect(screen.getByText("iced tea")).toBeDefined();
      });
      expect(mockParseFoodText).toHaveBeenLastCalledWith("iced tea");
    });
  });

  it("calls parse, create recipe, and add item", async () => {
    mockParseFoodText.mockResolvedValue({
      items: [
        food({
          name: "chicken stir fry",
          calories: 350,
          protein: 30,
          carbs: 20,
          fat: 12,
        }),
      ],
    });
    mockCreateRecipe.mockResolvedValue({ id: 42 });
    mockAddItem.mockResolvedValue({ id: 1 });

    renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
    await submitDish("chicken stir fry");

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

  // The sheet closes on add, so the confirmation is a toast (it fires its own
  // Success haptic — no second buzz).
  it("a successful add toasts the day and meal, with no extra Success haptic", async () => {
    mockParseFoodText.mockResolvedValue({ items: [food()] });
    mockCreateRecipe.mockResolvedValue({ id: 42 });
    mockAddItem.mockResolvedValue({ id: 1 });

    renderComponent(
      <SimpleEntrySheetContent {...defaultProps} plannedDate="2026-09-02" />,
    );
    await submitDish("soup");

    await waitFor(() => {
      expect(defaultProps.onDismiss).toHaveBeenCalledOnce();
    });
    expect(mockToastSuccess).toHaveBeenCalledExactlyOnceWith(
      "Added to Wednesday Lunch",
    );
    expect(mockNotification).not.toHaveBeenCalled();
  });

  // The picture is generated after the save, so the plan refreshed without it.
  // Owner decision 2026-11-20: a quick entry keeps no ingredients, so its
  // allergens cannot be checked; the toast says so for an eater with an
  // allergy. The check runs before anything is saved.
  it("checks the entry for this slot as not checkable, before saving it", async () => {
    mockParseFoodText.mockResolvedValue({ items: [food()] });
    mockCreateRecipe.mockResolvedValue({ id: 42 });
    mockAddItem.mockResolvedValue({ id: 1 });
    renderComponent(
      <SimpleEntrySheetContent {...defaultProps} plannedDate="2026-09-02" />,
    );
    await submitDish("soup");
    await waitFor(() => expect(mockAddItem).toHaveBeenCalled());
    expect(mockConfirmPick).toHaveBeenCalledWith({
      slot: { plannedDate: "2026-09-02", mealType: "lunch" },
      meal: { allergens: null },
    });
    expect(mockConfirmPick.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mockCreateRecipe.mock.invocationCallOrder.at(-1)!,
    );
  });

  it("says in the success toast when allergens could not be checked", async () => {
    mockConfirmPick.mockResolvedValueOnce({
      proceed: true,
      note: "Allergens not checked",
    });
    mockParseFoodText.mockResolvedValue({ items: [food()] });
    mockCreateRecipe.mockResolvedValue({ id: 42 });
    mockAddItem.mockResolvedValue({ id: 1 });
    renderComponent(
      <SimpleEntrySheetContent {...defaultProps} plannedDate="2026-09-02" />,
    );
    await submitDish("soup");
    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledExactlyOnceWith(
        "Added to Wednesday Lunch. Allergens not checked.",
      ),
    );
  });

  it("keeps checking the plan for the picture when the entry was saved without one", async () => {
    mockParseFoodText.mockResolvedValue({ items: [food()] });
    mockCreateRecipe.mockResolvedValue({ id: 42, imageUrl: null });
    mockAddItem.mockResolvedValue({ id: 1 });

    renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
    await submitDish("soup");

    await waitFor(() => {
      expect(defaultProps.onDismiss).toHaveBeenCalledOnce();
    });
    expect(mockPictureRefresh).toHaveBeenCalledOnce();
  });

  it("does not keep checking when the entry already has its picture", async () => {
    mockParseFoodText.mockResolvedValue({ items: [food()] });
    mockCreateRecipe.mockResolvedValue({
      id: 42,
      imageUrl: "https://cdn.example/recipe-images/soup.jpg",
    });
    mockAddItem.mockResolvedValue({ id: 1 });

    renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
    await submitDish("soup");

    await waitFor(() => {
      expect(defaultProps.onDismiss).toHaveBeenCalledOnce();
    });
    expect(mockPictureRefresh).not.toHaveBeenCalled();
  });

  it("does not keep checking after a failed add", async () => {
    mockParseFoodText.mockResolvedValue({ items: [food()] });
    mockCreateRecipe.mockResolvedValue({ id: 42, imageUrl: null });
    mockAddItem.mockRejectedValue(new Error("500"));

    renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
    await submitDish("soup");

    await waitFor(() => {
      expect(screen.getByText(ADD_ERROR)).toBeTruthy();
    });
    expect(mockPictureRefresh).not.toHaveBeenCalled();
  });

  it("a failed add says it couldn't add to the plan, with no success toast", async () => {
    mockParseFoodText.mockResolvedValue({ items: [food()] });
    mockCreateRecipe.mockResolvedValue({ id: 42 });
    mockAddItem.mockRejectedValue(new Error("500"));

    renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
    await submitDish("soup");

    await waitFor(() => {
      expect(screen.getByText(ADD_ERROR)).toBeTruthy();
    });
    expect(screen.queryByText(/Couldn't estimate nutrition/)).toBeNull();
    expect(mockToastSuccess).not.toHaveBeenCalled();
    expect(defaultProps.onDismiss).not.toHaveBeenCalled();
    // The mutations are silentError, so the sheet's own buzz is the only one.
    expect(mockNotification).toHaveBeenCalledTimes(1);
    expect(mockNotification).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
  });

  // The recipe was already created, so a retry must reuse it, not create a
  // second copy.
  it("retrying after a failed add reuses the created recipe", async () => {
    mockParseFoodText.mockResolvedValue({ items: [food()] });
    mockCreateRecipe.mockResolvedValue({ id: 42 });
    mockAddItem
      .mockRejectedValueOnce(new Error("500"))
      .mockResolvedValueOnce({ id: 1 });

    renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
    await submitDish("soup");
    await waitFor(() => {
      expect(screen.getByText(ADD_ERROR)).toBeTruthy();
    });

    pressAdd();

    await waitFor(() => {
      expect(defaultProps.onDismiss).toHaveBeenCalledOnce();
    });
    expect(mockParseFoodText).toHaveBeenCalledOnce();
    expect(mockCreateRecipe).toHaveBeenCalledOnce();
    expect(mockAddItem).toHaveBeenCalledTimes(2);
    expect(mockAddItem).toHaveBeenLastCalledWith(
      expect.objectContaining({ recipeId: 42 }),
    );
    expect(mockToastSuccess).toHaveBeenCalledOnce();
  });

  // The saved recipe carries the old numbers, so it must not be reused.
  it("changing an amount after a failed add saves a fresh recipe", async () => {
    mockParseFoodText.mockResolvedValue({ items: [food({ quantity: 2 })] });
    mockCreateRecipe
      .mockResolvedValueOnce({ id: 42 })
      .mockResolvedValueOnce({ id: 43 });
    mockAddItem
      .mockRejectedValueOnce(new Error("500"))
      .mockResolvedValueOnce({ id: 1 });

    renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
    await submitDish("soup");
    await waitFor(() => {
      expect(screen.getByText(ADD_ERROR)).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText("More soup"));
    pressAdd();

    await waitFor(() => {
      expect(defaultProps.onDismiss).toHaveBeenCalledOnce();
    });
    expect(mockCreateRecipe).toHaveBeenCalledTimes(2);
    expect(mockCreateRecipe).toHaveBeenLastCalledWith(
      expect.objectContaining({ caloriesPerServing: "125" }),
    );
    expect(mockAddItem).toHaveBeenLastCalledWith(
      expect.objectContaining({ recipeId: 43 }),
    );
  });

  it("a changed dish name after a failed add creates a fresh recipe", async () => {
    mockParseFoodText.mockResolvedValue({ items: [food()] });
    mockCreateRecipe
      .mockResolvedValueOnce({ id: 42 })
      .mockResolvedValueOnce({ id: 43 });
    mockAddItem
      .mockRejectedValueOnce(new Error("500"))
      .mockResolvedValueOnce({ id: 1 });

    renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
    await submitDish("soup");
    await waitFor(() => {
      expect(screen.getByText(ADD_ERROR)).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText("Edit dish name"));
    await submitDish("tomato soup");

    await waitFor(() => {
      expect(defaultProps.onDismiss).toHaveBeenCalledOnce();
    });
    expect(mockCreateRecipe).toHaveBeenCalledTimes(2);
    expect(mockAddItem).toHaveBeenLastCalledWith(
      expect.objectContaining({ recipeId: 43 }),
    );
  });

  it("shows error when parse returns empty items", async () => {
    mockParseFoodText.mockResolvedValue({ items: [] });

    renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
    typeDish("asdfghjkl");
    fireEvent.click(screen.getByText("Estimate"));

    await waitFor(() => {
      expect(screen.getByText(PARSE_ERROR)).toBeDefined();
    });
    expect(screen.queryByText("Add to Lunch")).toBeNull();
  });

  it("shows error when parse throws", async () => {
    mockParseFoodText.mockRejectedValue(new Error("API error"));

    renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
    typeDish("something");
    fireEvent.click(screen.getByText("Estimate"));

    await waitFor(() => {
      expect(screen.getByText(PARSE_ERROR)).toBeDefined();
    });
  });

  it("shows the upgrade modal when parsing is blocked by PREMIUM_REQUIRED", async () => {
    mockParseFoodText.mockRejectedValue(
      new ApiError("403: Premium required", "PREMIUM_REQUIRED"),
    );

    renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
    typeDish("something");
    fireEvent.click(screen.getByText("Estimate"));

    await waitFor(() => {
      expect(screen.getByText("UPGRADE_MODAL_SHOWN")).toBeDefined();
    });
    // The generic parse-failure message must not appear for a premium block.
    expect(screen.queryByText(PARSE_ERROR)).toBeNull();
    // A premium block is an offer, not a failure: no Error buzz.
    expect(mockNotification).not.toHaveBeenCalled();
  });

  describe("voice dictation", () => {
    it("renders mic button for premium users", () => {
      mockHasVoiceLogging = true;
      renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
      expect(screen.getByLabelText("Start voice input")).toBeDefined();
    });

    it("hides mic button for free users", () => {
      mockHasVoiceLogging = false;
      renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
      expect(screen.queryByLabelText("Start voice input")).toBeNull();
    });

    it("calls startListening on mic press when idle", () => {
      renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
      fireEvent.click(screen.getByLabelText("Start voice input"));
      expect(mockStartListening).toHaveBeenCalledOnce();
    });

    it("calls stopListening on mic press when listening", () => {
      mockIsListening = true;
      renderComponent(<SimpleEntrySheetContent {...defaultProps} />);
      fireEvent.click(screen.getByLabelText("Listening, tap to stop"));
      expect(mockStopListening).toHaveBeenCalledOnce();
    });

    it("shows error when speech recognition has an error", async () => {
      // Set error before mount — mealType effect runs first (clears error),
      // then speechError effect runs (sets error)
      mockSpeechError =
        "Microphone or speech recognition permission not granted.";
      renderComponent(<SimpleEntrySheetContent {...defaultProps} />);

      await waitFor(() => {
        expect(
          screen.getByText(
            "Microphone or speech recognition permission not granted.",
          ),
        ).toBeDefined();
      });
    });

    it("starting and stopping dictation while open keeps the error and dish name", async () => {
      mockParseFoodText.mockResolvedValue({ items: [] });
      const { rerender } = renderComponent(
        <SimpleEntrySheetContent {...defaultProps} />,
      );

      typeDish("mystery stew");
      fireEvent.click(screen.getByText("Estimate"));
      await waitFor(() => {
        expect(screen.getByText(PARSE_ERROR)).toBeDefined();
      });

      // Dictation starts (no transcript yet), then stops. The content is
      // React.memo, so a fresh onDismiss forces the re-render the real
      // hook's state change would cause.
      mockIsListening = true;
      rerender(
        <SimpleEntrySheetContent {...defaultProps} onDismiss={vi.fn()} />,
      );
      mockIsListening = false;
      rerender(
        <SimpleEntrySheetContent {...defaultProps} onDismiss={vi.fn()} />,
      );

      expect(screen.getByText(PARSE_ERROR)).toBeDefined();
      expect(
        (screen.getByLabelText("Dish name") as HTMLInputElement).value,
      ).toBe("mystery stew");
      expect(mockStopListening).not.toHaveBeenCalled();
    });

    it("stops an in-progress dictation when the sheet closes", () => {
      mockIsListening = true;
      const { rerender } = renderComponent(
        <SimpleEntrySheetContent {...defaultProps} />,
      );
      expect(mockStopListening).not.toHaveBeenCalled();

      rerender(<SimpleEntrySheetContent {...defaultProps} mealType={null} />);
      expect(mockStopListening).toHaveBeenCalledOnce();
    });

    it("reopening the sheet starts over: no review, empty dish name", async () => {
      mockParseFoodText.mockResolvedValue({ items: [food()] });
      const { rerender } = renderComponent(
        <SimpleEntrySheetContent {...defaultProps} />,
      );
      await estimate("soup");

      rerender(<SimpleEntrySheetContent {...defaultProps} mealType={null} />);
      rerender(<SimpleEntrySheetContent {...defaultProps} />);

      expect(screen.queryByText("Add to Lunch")).toBeNull();
      expect(
        (screen.getByLabelText("Dish name") as HTMLInputElement).value,
      ).toBe("");
    });
  });
});

describe("SimpleEntrySheet — dish name label", () => {
  const props = {
    mealType: "lunch" as const,
    plannedDate: "2025-06-01",
    onDismiss: vi.fn(),
  };

  beforeEach(() => {
    mockIsListening = false;
  });

  it('floats "Dish name" on the field and holds the example back until focus', () => {
    renderComponent(<SimpleEntrySheetContent {...props} />);
    expect(
      screen.getAllByTestId("focus-field-label").map((l) => l.textContent),
    ).toContain("Dish name");
    const input = screen.getByLabelText("Dish name");
    expect(input.getAttribute("placeholder")).toBeNull();
    fireEvent.focus(input);
    expect(input.getAttribute("placeholder")).toBe("e.g. chicken stir fry");
  });

  it("floats the label while listening so the Listening placeholder shows", () => {
    mockIsListening = true;
    renderComponent(<SimpleEntrySheetContent {...props} />);
    expect(screen.getByLabelText("Dish name").getAttribute("placeholder")).toBe(
      "Listening...",
    );
  });
});
