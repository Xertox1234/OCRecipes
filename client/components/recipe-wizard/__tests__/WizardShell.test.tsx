// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";

// Import AFTER mocks so module-hoisted mocks are applied.
import WizardShell from "../WizardShell";
import { inferCuisine, inferDietTags } from "@/lib/recipe-tag-inference";

// ── Test-only step stubs ─────────────────────────────────────────────────────
// Replace the real step content with marker elements + tiny test harnesses so
// the tests can drive form state via buttons/inputs without depending on the
// real step UIs. Each stub is declared BEFORE the import that triggers
// `vi.mock` hoisting.
vi.mock("../TitleStep", () => ({
  __esModule: true,
  default: ({
    title,
    setTitle,
  }: {
    title: string;
    setTitle: (t: string) => void;
    description: string;
    setDescription: (d: string) => void;
  }) => (
    <div data-testid="step-title">
      <span data-testid="step-title-value">{title}</span>
      <button
        onClick={() => setTitle("My Recipe")}
        data-testid="set-valid-title"
      >
        set valid title
      </button>
      <button onClick={() => setTitle("Hi")} data-testid="set-short-title">
        set short title
      </button>
    </div>
  ),
}));

vi.mock("../IngredientsStep", () => ({
  __esModule: true,
  default: ({
    ingredients,
    updateIngredient,
  }: {
    ingredients: { key: string; text: string }[];
    addIngredient: () => void;
    removeIngredient: (k: string) => void;
    updateIngredient: (k: string, t: string) => void;
  }) => (
    <div data-testid="step-ingredients">
      <span data-testid="step-ingredients-count">{ingredients.length}</span>
      <button
        onClick={() => updateIngredient(ingredients[0].key, "2 cups flour")}
        data-testid="set-ingredient"
      >
        add ingredient
      </button>
    </div>
  ),
}));

vi.mock("../InstructionsStep", () => ({
  __esModule: true,
  default: ({
    steps,
    updateStep,
  }: {
    steps: { key: string; text: string }[];
    addStep: () => void;
    removeStep: (k: string) => void;
    updateStep: (k: string, t: string) => void;
    moveStep: (k: string, d: "up" | "down") => void;
  }) => (
    <div data-testid="step-instructions">
      <button
        onClick={() => updateStep(steps[0].key, "Mix everything")}
        data-testid="set-step"
      >
        add step
      </button>
    </div>
  ),
}));

vi.mock("../TimeServingsStep", () => ({
  __esModule: true,
  default: () => <div data-testid="step-time" />,
}));

vi.mock("../NutritionStep", () => ({
  __esModule: true,
  default: ({
    nutrition,
  }: {
    nutrition: {
      calories: string;
      protein: string;
      carbs: string;
      fat: string;
    };
    setNutrition: (n: unknown) => void;
  }) => (
    <div data-testid="step-nutrition">
      <span data-testid="nutrition-calories">{nutrition.calories || "-"}</span>
    </div>
  ),
}));

vi.mock("../TagsStep", () => ({
  __esModule: true,
  default: ({
    tags,
  }: {
    tags: { cuisine: string; dietTags: string[] };
    setTags: (t: unknown) => void;
  }) => (
    <div data-testid="step-tags">
      <span data-testid="tags-cuisine">{tags.cuisine || "-"}</span>
      <span data-testid="tags-diet">{tags.dietTags.join(",") || "-"}</span>
    </div>
  ),
}));

vi.mock("../PreviewStep", () => ({
  __esModule: true,
  default: ({
    onEditStep,
  }: {
    form: unknown;
    onEditStep: (step: number) => void;
  }) => (
    <div data-testid="step-preview">
      <button onClick={() => onEditStep(1)} data-testid="preview-edit-title">
        edit title
      </button>
      <button onClick={() => onEditStep(4)} data-testid="preview-edit-time">
        edit time
      </button>
    </div>
  ),
}));

// ── Mutation mocks ───────────────────────────────────────────────────────────

const mutateCreate = vi.fn();
const mutateAddItem = vi.fn();
let createIsPending = false;

vi.mock("@/hooks/useMealPlanRecipes", () => ({
  useCreateMealPlanRecipe: () => ({
    mutateAsync: mutateCreate,
    get isPending() {
      return createIsPending;
    },
  }),
}));

vi.mock("@/hooks/useMealPlan", () => ({
  useAddMealPlanItem: () => ({
    mutateAsync: mutateAddItem,
    isPending: false,
  }),
}));

vi.mock("@/lib/recipe-tag-inference", () => ({
  inferCuisine: vi.fn((_title: string, ingredients: string[]) =>
    ingredients.some((i) => i.toLowerCase().includes("flour"))
      ? "Italian"
      : null,
  ),
  inferDietTags: vi.fn((ingredients: string[]) =>
    ingredients.length > 0 ? ["Vegetarian"] : [],
  ),
}));

function clickNext() {
  fireEvent.click(
    screen.getByRole("button", { name: /Next:|Save Recipe|Skip/ }),
  );
}

function clickBack() {
  fireEvent.click(screen.getByRole("button", { name: /Back to / }));
}

describe("WizardShell", () => {
  beforeEach(() => {
    mutateCreate.mockReset();
    mutateAddItem.mockReset();
    createIsPending = false;
    vi.mocked(inferCuisine).mockClear();
    vi.mocked(inferDietTags).mockClear();
  });

  // ── Step transitions ───────────────────────────────────────────────────────

  it("starts on step 1 (Title) with only a next button", () => {
    renderComponent(
      <WizardShell onGoBack={vi.fn()} onSaveComplete={vi.fn()} />,
    );
    expect(screen.getByTestId("step-title")).toBeDefined();
    expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
    expect(
      screen.getByRole("button", { name: /Next: Ingredients/ }),
    ).toBeDefined();
  });

  it("blocks advancing past step 1 if title is too short", () => {
    renderComponent(
      <WizardShell onGoBack={vi.fn()} onSaveComplete={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("set-short-title"));
    clickNext();
    expect(
      screen.getByText("Recipe name must be at least 3 characters"),
    ).toBeDefined();
    // Still on step 1.
    expect(screen.getByTestId("step-title")).toBeDefined();
  });

  it("advances from step 1 to step 2 when title is valid", () => {
    renderComponent(
      <WizardShell onGoBack={vi.fn()} onSaveComplete={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("set-valid-title"));
    clickNext();
    expect(screen.getByTestId("step-ingredients")).toBeDefined();
  });

  it("blocks advancing past step 2 if no ingredients", () => {
    renderComponent(
      <WizardShell onGoBack={vi.fn()} onSaveComplete={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("set-valid-title"));
    clickNext();
    // No ingredient text yet.
    clickNext();
    expect(screen.getByText("Add at least one ingredient")).toBeDefined();
    expect(screen.getByTestId("step-ingredients")).toBeDefined();
  });

  it("blocks advancing past step 3 if no instructions", () => {
    renderComponent(
      <WizardShell onGoBack={vi.fn()} onSaveComplete={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("set-valid-title"));
    clickNext();
    fireEvent.click(screen.getByTestId("set-ingredient"));
    clickNext();
    // On instructions, no step yet.
    clickNext();
    expect(screen.getByText("Add at least one instruction step")).toBeDefined();
  });

  it("goes back one step via the Back button", () => {
    renderComponent(
      <WizardShell onGoBack={vi.fn()} onSaveComplete={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("set-valid-title"));
    clickNext();
    expect(screen.getByTestId("step-ingredients")).toBeDefined();
    clickBack();
    expect(screen.getByTestId("step-title")).toBeDefined();
  });

  it("calls onGoBack (not goBack-within) when Back is pressed on step 1", () => {
    const onGoBack = vi.fn();
    renderComponent(
      <WizardShell onGoBack={onGoBack} onSaveComplete={vi.fn()} />,
    );
    // There's no back button on step 1, so the wizard never shows one — this
    // is a guard test ensuring we don't render it.
    expect(screen.queryByRole("button", { name: /Back to/ })).toBeNull();
    expect(onGoBack).not.toHaveBeenCalled();
  });

  it("shows 'Skip' label on the Nutrition step when nutrition is empty", () => {
    renderComponent(
      <WizardShell onGoBack={vi.fn()} onSaveComplete={vi.fn()} />,
    );
    // Walk: 1 → 2 → 3 → 4 → 5
    fireEvent.click(screen.getByTestId("set-valid-title"));
    clickNext();
    fireEvent.click(screen.getByTestId("set-ingredient"));
    clickNext();
    fireEvent.click(screen.getByTestId("set-step"));
    clickNext();
    clickNext(); // step 4 → 5
    expect(screen.getByTestId("step-nutrition")).toBeDefined();
    expect(screen.getByRole("button", { name: "Skip" })).toBeDefined();
  });

  // ── Tag inference on entering step 6 ──────────────────────────────────────

  it("fires inferCuisine/inferDietTags when arriving at step 6 (Tags)", () => {
    renderComponent(
      <WizardShell onGoBack={vi.fn()} onSaveComplete={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("set-valid-title"));
    clickNext();
    fireEvent.click(screen.getByTestId("set-ingredient"));
    clickNext();
    fireEvent.click(screen.getByTestId("set-step"));
    clickNext();
    clickNext(); // 4 → 5
    clickNext(); // 5 → 6 (triggers tag inference)
    expect(inferCuisine).toHaveBeenCalled();
    expect(inferDietTags).toHaveBeenCalled();
    expect(screen.getByTestId("step-tags")).toBeDefined();
  });

  it("applies inferred cuisine and diet tags when user has none set", () => {
    renderComponent(
      <WizardShell onGoBack={vi.fn()} onSaveComplete={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("set-valid-title"));
    clickNext();
    fireEvent.click(screen.getByTestId("set-ingredient"));
    clickNext();
    fireEvent.click(screen.getByTestId("set-step"));
    clickNext();
    clickNext(); // 4 → 5
    clickNext(); // 5 → 6
    // Our mocks return "Italian" + ["Vegetarian"].
    expect(screen.getByTestId("tags-cuisine").textContent).toBe("Italian");
    expect(screen.getByTestId("tags-diet").textContent).toBe("Vegetarian");
  });

  // ── Preview & edit-from-preview ────────────────────────────────────────────

  it("shows the preview step with 'Save Recipe' button at step 7", () => {
    renderComponent(
      <WizardShell onGoBack={vi.fn()} onSaveComplete={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("set-valid-title"));
    clickNext();
    fireEvent.click(screen.getByTestId("set-ingredient"));
    clickNext();
    fireEvent.click(screen.getByTestId("set-step"));
    clickNext();
    clickNext(); // 4 → 5
    clickNext(); // 5 → 6
    clickNext(); // 6 → 7
    expect(screen.getByTestId("step-preview")).toBeDefined();
    expect(screen.getByRole("button", { name: "Save Recipe" })).toBeDefined();
  });

  it("editFromPreview jumps to the requested step and returns to preview on next", () => {
    renderComponent(
      <WizardShell onGoBack={vi.fn()} onSaveComplete={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId("set-valid-title"));
    clickNext();
    fireEvent.click(screen.getByTestId("set-ingredient"));
    clickNext();
    fireEvent.click(screen.getByTestId("set-step"));
    clickNext();
    clickNext(); // 4 → 5
    clickNext(); // 5 → 6
    clickNext(); // 6 → 7 (Preview)

    // From preview, edit time & servings (step 4).
    fireEvent.click(screen.getByTestId("preview-edit-time"));
    expect(screen.getByTestId("step-time")).toBeDefined();

    // Pressing next from a returned-to-preview step jumps back to preview.
    clickNext();
    expect(screen.getByTestId("step-preview")).toBeDefined();
  });

  // ── Save flow ──────────────────────────────────────────────────────────────

  it("calls createMutation with a payload and onSaveComplete on save", async () => {
    mutateCreate.mockResolvedValue({ id: 42 });
    const onSaveComplete = vi.fn();
    renderComponent(
      <WizardShell onGoBack={vi.fn()} onSaveComplete={onSaveComplete} />,
    );
    fireEvent.click(screen.getByTestId("set-valid-title"));
    clickNext();
    fireEvent.click(screen.getByTestId("set-ingredient"));
    clickNext();
    fireEvent.click(screen.getByTestId("set-step"));
    clickNext();
    clickNext(); // 4 → 5
    clickNext(); // 5 → 6
    clickNext(); // 6 → 7

    fireEvent.click(screen.getByRole("button", { name: "Save Recipe" }));

    await waitFor(() => expect(mutateCreate).toHaveBeenCalled());
    expect(mutateCreate.mock.calls[0][0]).toMatchObject({ title: "My Recipe" });
    await waitFor(() => expect(onSaveComplete).toHaveBeenCalled());
  });

  it("adds a meal plan item when returnToMealPlan is provided", async () => {
    mutateCreate.mockResolvedValue({ id: 77 });
    mutateAddItem.mockResolvedValue({ id: 9 });
    renderComponent(
      <WizardShell
        onGoBack={vi.fn()}
        onSaveComplete={vi.fn()}
        returnToMealPlan={{
          mealType: "dinner",
          plannedDate: "2026-01-01",
        }}
      />,
    );
    fireEvent.click(screen.getByTestId("set-valid-title"));
    clickNext();
    fireEvent.click(screen.getByTestId("set-ingredient"));
    clickNext();
    fireEvent.click(screen.getByTestId("set-step"));
    clickNext();
    clickNext();
    clickNext();
    clickNext();
    fireEvent.click(screen.getByRole("button", { name: "Save Recipe" }));
    await waitFor(() => expect(mutateAddItem).toHaveBeenCalled());
    expect(mutateAddItem).toHaveBeenCalledWith({
      recipeId: 77,
      mealType: "dinner",
      plannedDate: "2026-01-01",
    });
  });

  // ── Dirty / saving callbacks (L22 — action-fired, not useEffect) ──────────

  it("fires onDirtyChange(true) on the first edit (not on mount)", () => {
    const onDirtyChange = vi.fn();
    renderComponent(
      <WizardShell
        onGoBack={vi.fn()}
        onSaveComplete={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );
    // No edits yet — no call.
    expect(onDirtyChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("set-valid-title"));
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it("does not fire onDirtyChange again on subsequent edits (no transition)", () => {
    const onDirtyChange = vi.fn();
    renderComponent(
      <WizardShell
        onGoBack={vi.fn()}
        onSaveComplete={vi.fn()}
        onDirtyChange={onDirtyChange}
      />,
    );
    fireEvent.click(screen.getByTestId("set-valid-title"));
    clickNext();
    fireEvent.click(screen.getByTestId("set-ingredient"));
    // Only the first transition should have fired.
    expect(onDirtyChange).toHaveBeenCalledTimes(1);
  });

  it("fires onSavingChange(true) then onSavingChange(false) around save", async () => {
    mutateCreate.mockResolvedValue({ id: 1 });
    const onSavingChange = vi.fn();
    renderComponent(
      <WizardShell
        onGoBack={vi.fn()}
        onSaveComplete={vi.fn()}
        onSavingChange={onSavingChange}
      />,
    );
    fireEvent.click(screen.getByTestId("set-valid-title"));
    clickNext();
    fireEvent.click(screen.getByTestId("set-ingredient"));
    clickNext();
    fireEvent.click(screen.getByTestId("set-step"));
    clickNext();
    clickNext();
    clickNext();
    clickNext();
    fireEvent.click(screen.getByRole("button", { name: "Save Recipe" }));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalled());
    await waitFor(() => expect(onSavingChange).toHaveBeenCalledWith(false));
    // True fires before false.
    expect(onSavingChange.mock.calls[0][0]).toBe(true);
    expect(onSavingChange).toHaveBeenCalledWith(false);
  });

  it("fires onSavingChange(false) even if createMutation rejects", async () => {
    mutateCreate.mockRejectedValue(new Error("boom"));
    const onSavingChange = vi.fn();
    renderComponent(
      <WizardShell
        onGoBack={vi.fn()}
        onSaveComplete={vi.fn()}
        onSavingChange={onSavingChange}
      />,
    );
    fireEvent.click(screen.getByTestId("set-valid-title"));
    clickNext();
    fireEvent.click(screen.getByTestId("set-ingredient"));
    clickNext();
    fireEvent.click(screen.getByTestId("set-step"));
    clickNext();
    clickNext();
    clickNext();
    clickNext();
    fireEvent.click(screen.getByRole("button", { name: "Save Recipe" }));
    await waitFor(() => expect(mutateCreate).toHaveBeenCalled());
    await waitFor(() => expect(onSavingChange).toHaveBeenLastCalledWith(false));
  });

  // ── Prefill ────────────────────────────────────────────────────────────────

  it("marks dirty on mount when prefill is provided", async () => {
    const onDirtyChange = vi.fn();
    const prefill = {
      title: "Imported",
      description: null,
      servings: null,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
      cuisine: null,
      dietTags: [],
      ingredients: [],
      instructions: null,
      imageUrl: null,
      caloriesPerServing: null,
      proteinPerServing: null,
      carbsPerServing: null,
      fatPerServing: null,
      sourceUrl: "https://example.com",
    };
    renderComponent(
      <WizardShell
        onGoBack={vi.fn()}
        onSaveComplete={vi.fn()}
        onDirtyChange={onDirtyChange}
        prefill={prefill}
      />,
    );
    await waitFor(() => expect(onDirtyChange).toHaveBeenCalledWith(true));
  });
});
