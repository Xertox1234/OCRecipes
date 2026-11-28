// @vitest-environment jsdom
//
// Owner decision 2026-11-28: saving a pantry-generated plan runs the allergen
// check first, as one summary warning for the whole plan
// (todos/archive/P3-2026-11-27-pantry-plan-save-has-no-allergen-check.md).
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, screen } from "@testing-library/react";

import { renderComponent } from "../../../../test/utils/render-component";
import ReceiptMealPlanScreen from "../ReceiptMealPlanScreen";

const h = vi.hoisted(() => ({
  save: vi.fn(),
  confirmBatch: vi.fn(async () => ({
    proceed: true,
    note: null as string | null,
  })),
  toastSuccess: vi.fn(),
}));

const meal = (title: string, ingredient: string) => ({
  mealType: "dinner",
  title,
  description: "",
  servings: 2,
  prepTimeMinutes: 5,
  cookTimeMinutes: 10,
  difficulty: "Easy",
  ingredients: [{ name: ingredient, quantity: "1", unit: "cup" }],
  instructions: "Cook.",
  dietTags: [],
  caloriesPerServing: 400,
  proteinPerServing: 20,
  carbsPerServing: 40,
  fatPerServing: 10,
});

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: vi.fn(), popToTop: vi.fn() }),
  useRoute: () => ({ params: { startDate: "2026-12-01" } }),
}));
vi.mock("@/hooks/useGenerateMealPlan", () => ({
  useGenerateMealPlanFromPantry: () => ({
    mutate: (_input: unknown, opts: { onSuccess: (r: unknown) => void }) =>
      opts.onSuccess({
        days: [
          {
            dayNumber: 1,
            meals: [
              meal("Satay noodles", "peanut butter"),
              meal("Rice bowl", "rice"),
            ],
          },
        ],
      }),
    isPending: false,
    isError: false,
    error: null,
  }),
  useSaveGeneratedMealPlan: () => ({ mutate: h.save, isPending: false }),
}));
vi.mock("@/hooks/useConfirmPlanPick", () => ({
  useConfirmPlanBatch: () => h.confirmBatch,
}));
vi.mock("@/context/ToastContext", () => ({
  useToast: () => ({ success: h.toastSuccess, error: vi.fn(), info: vi.fn() }),
}));

async function generateThenSave() {
  renderComponent(<ReceiptMealPlanScreen />);
  fireEvent.click(screen.getByLabelText("Generate meal plan"));
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Add 2 meals to plan"));
  });
}

describe("ReceiptMealPlanScreen — allergen check before saving the plan", () => {
  beforeEach(() => {
    h.save.mockReset();
    h.toastSuccess.mockReset();
    h.confirmBatch.mockClear();
  });

  it("checks every meal's ingredients before saving", async () => {
    await generateThenSave();
    expect(h.confirmBatch).toHaveBeenCalledTimes(1);
    const [meals] = h.confirmBatch.mock.calls[0] as unknown as [
      { title: string; meal: { allergens: { id: string }[] | null } }[],
    ];
    expect(meals.map((m) => m.title)).toEqual(["Satay noodles", "Rice bowl"]);
    expect(meals[0].meal.allergens?.map((a) => a.id)).toContain("peanuts");
    expect(meals[1].meal.allergens).toEqual([]);
    expect(h.save).toHaveBeenCalledTimes(1);
  });

  it("saves nothing when the user cancels at the warning", async () => {
    h.confirmBatch.mockResolvedValueOnce({ proceed: false, note: null });
    await generateThenSave();
    expect(h.save).not.toHaveBeenCalled();
  });

  it("says when allergens could not be checked once the plan is saved", async () => {
    h.confirmBatch.mockResolvedValueOnce({
      proceed: true,
      note: "Allergens not checked",
    });
    h.save.mockImplementation((_m, opts: { onSuccess: () => void }) =>
      opts.onSuccess(),
    );
    await generateThenSave();
    expect(h.toastSuccess).toHaveBeenCalledWith(
      "Plan saved. Allergens not checked.",
    );
  });
});
