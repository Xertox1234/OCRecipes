// @vitest-environment jsdom
import { renderHook, act } from "@testing-library/react";

import { usePlanSuggestFlow } from "../usePlanSuggestFlow";
import type { MealSuggestion } from "@shared/types/meal-suggestions";

const { mockAdd, haptics, toast } = vi.hoisted(() => ({
  mockAdd: vi.fn(),
  haptics: { impact: vi.fn(), notification: vi.fn() },
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("../useMealPlan", () => ({
  useAddMealPlanItem: () => ({ mutateAsync: mockAdd }),
}));
vi.mock("../useHaptics", () => ({ useHaptics: () => haptics }));
const { mockConfirmPick } = vi.hoisted(() => ({
  mockConfirmPick: vi.fn(async () => ({
    proceed: true,
    note: null as string | null,
  })),
}));
vi.mock("@/hooks/useConfirmPlanPick", () => ({
  useConfirmPlanPick: () => mockConfirmPick,
}));
vi.mock("@/context/ToastContext", () => ({ useToast: () => toast }));

const suggestion = {
  title: "Lentil soup",
  description: "Warm and easy",
  difficulty: "Easy",
  prepTimeMinutes: 20,
  instructions: ["Simmer"],
  dietTags: [],
  calories: 400,
  protein: 20,
  carbs: 50,
  fat: 10,
  ingredients: [{ name: "lentils", quantity: "1", unit: "cup" }],
} as unknown as MealSuggestion;

describe("usePlanSuggestFlow", () => {
  beforeEach(() => vi.clearAllMocks());

  function setup(canSuggest = true, dateStr = "2026-11-19") {
    return renderHook(() =>
      usePlanSuggestFlow({
        dateStr,
        initialMealType: "dinner",
        canSuggest,
      }),
    );
  }

  it("starts closed on the initial meal type", () => {
    const { result } = setup();
    expect(result.current.suggestModalVisible).toBe(false);
    expect(result.current.showUpgradeModal).toBe(false);
    expect(result.current.suggestMealType).toBe("dinner");
  });

  it("opens the suggestions for the tapped meal with a light haptic", () => {
    const { result } = setup();
    act(() => result.current.handleSuggest("lunch"));
    expect(result.current.suggestModalVisible).toBe(true);
    expect(result.current.suggestMealType).toBe("lunch");
    expect(haptics.impact).toHaveBeenCalledWith("light");
  });

  it("shows the upgrade modal instead when suggestions are not in the plan", () => {
    const { result } = setup(false);
    act(() => result.current.handleSuggest("lunch"));
    expect(result.current.suggestModalVisible).toBe(false);
    expect(result.current.showUpgradeModal).toBe(true);
    expect(haptics.notification).toHaveBeenCalledWith("warning");
  });

  it("adds the chosen suggestion to the day and meal, toasts and closes", async () => {
    mockAdd.mockResolvedValue({});
    const { result } = setup(true, "2026-11-20");
    act(() => result.current.handleSuggest("lunch"));
    await act(() => result.current.handleSelectSuggestion(suggestion));
    expect(mockAdd).toHaveBeenCalledWith(
      expect.objectContaining({ plannedDate: "2026-11-20", mealType: "lunch" }),
    );
    expect(toast.success).toHaveBeenCalledOnce();
    expect(result.current.suggestModalVisible).toBe(false);
  });

  // Owner decision 2026-11-20: the allergen check runs before the add. The
  // suggestion is not saved yet, so its ingredients are checked.
  it("checks the suggestion's ingredients for this slot before adding", async () => {
    const { result } = setup();
    act(() => result.current.handleSuggest("lunch"));
    await act(() =>
      result.current.handleSelectSuggestion({
        ...suggestion,
        ingredients: [{ name: "peanut butter", quantity: "2", unit: "tbsp" }],
      } as MealSuggestion),
    );
    expect(mockConfirmPick).toHaveBeenCalledWith({
      slot: { plannedDate: "2026-11-19", mealType: "lunch" },
      meal: {
        allergens: [expect.objectContaining({ id: "peanuts" })],
      },
    });
  });

  it("adds nothing and keeps the modal open when the user cancels at the allergy warning", async () => {
    mockConfirmPick.mockResolvedValueOnce({ proceed: false, note: null });
    const { result } = setup();
    act(() => result.current.handleSuggest("lunch"));
    await act(() => result.current.handleSelectSuggestion(suggestion));
    expect(mockAdd).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(result.current.suggestModalVisible).toBe(true);
  });

  it("says in the success toast when allergens could not be checked", async () => {
    mockConfirmPick.mockResolvedValueOnce({
      proceed: true,
      note: "Allergens not checked",
    });
    const { result } = setup();
    act(() => result.current.handleSuggest("lunch"));
    await act(() => result.current.handleSelectSuggestion(suggestion));
    expect(toast.success).toHaveBeenCalledWith(
      expect.stringMatching(/\. Allergens not checked$/),
    );
  });

  it("keeps the modal open and shows an error when the add fails", async () => {
    mockAdd.mockRejectedValue(new Error("offline"));
    const { result } = setup();
    act(() => result.current.handleSuggest("lunch"));
    await act(() => result.current.handleSelectSuggestion(suggestion));
    expect(toast.error).toHaveBeenCalledWith(
      "Couldn't add the suggestion to your plan. Please try again.",
    );
    expect(result.current.suggestModalVisible).toBe(true);
  });

  it("closes either modal on request", () => {
    const { result } = setup(false);
    act(() => result.current.handleSuggest("lunch"));
    act(() => result.current.setShowUpgradeModal(false));
    expect(result.current.showUpgradeModal).toBe(false);
    const open = setup();
    act(() => open.result.current.handleSuggest("lunch"));
    act(() => open.result.current.closeSuggest());
    expect(open.result.current.suggestModalVisible).toBe(false);
  });
});
