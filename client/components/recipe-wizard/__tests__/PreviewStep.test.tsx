// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import PreviewStep, { hasNutrition, MacroItem } from "../PreviewStep";
import type { NutritionData } from "@/hooks/useRecipeForm";

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe("hasNutrition", () => {
  it("returns false when every macro field is empty string", () => {
    const nutrition: NutritionData = {
      calories: "",
      protein: "",
      carbs: "",
      fat: "",
    };
    expect(hasNutrition(nutrition)).toBe(false);
  });

  it("returns a strict boolean (not a string or number)", () => {
    const nutrition: NutritionData = {
      calories: "200",
      protein: "",
      carbs: "",
      fat: "",
    };
    const result = hasNutrition(nutrition);
    expect(result).toBe(true);
    expect(typeof result).toBe("boolean");
  });

  it("returns true when only calories is set", () => {
    expect(
      hasNutrition({ calories: "300", protein: "", carbs: "", fat: "" }),
    ).toBe(true);
  });

  it("returns true when only protein is set", () => {
    expect(
      hasNutrition({ calories: "", protein: "30", carbs: "", fat: "" }),
    ).toBe(true);
  });

  it("returns true when only carbs is set", () => {
    expect(
      hasNutrition({ calories: "", protein: "", carbs: "50", fat: "" }),
    ).toBe(true);
  });

  it("returns true when only fat is set", () => {
    expect(
      hasNutrition({ calories: "", protein: "", carbs: "", fat: "10" }),
    ).toBe(true);
  });

  it("returns true when all macros are set", () => {
    expect(
      hasNutrition({
        calories: "400",
        protein: "30",
        carbs: "40",
        fat: "15",
      }),
    ).toBe(true);
  });
});

// ── MacroItem component ──────────────────────────────────────────────────────

describe("MacroItem", () => {
  it("renders the numeric value", () => {
    renderComponent(
      <MacroItem value="250" label="cal" valueColor="#000" labelColor="#666" />,
    );
    expect(screen.getByText("250")).toBeDefined();
  });

  it("renders the label", () => {
    renderComponent(
      <MacroItem
        value="250"
        label="protein"
        valueColor="#000"
        labelColor="#666"
      />,
    );
    expect(screen.getByText("protein")).toBeDefined();
  });

  it("appends unit suffix to the value when provided", () => {
    renderComponent(
      <MacroItem
        value="30"
        unit="g"
        label="protein"
        valueColor="#000"
        labelColor="#666"
      />,
    );
    expect(screen.getByText("30g")).toBeDefined();
  });

  it("omits unit suffix when not provided", () => {
    renderComponent(
      <MacroItem value="250" label="cal" valueColor="#000" labelColor="#666" />,
    );
    // No stray "undefined" rendered.
    expect(screen.queryByText(/undefined/)).toBeNull();
  });
});

// ── Rendered PreviewStep (edit labels — M21 fix) ────────────────────────────

function makeForm(overrides: Record<string, unknown> = {}) {
  return {
    title: "Pancakes",
    description: "",
    ingredients: [{ key: "ing_1", text: "2 cups flour" }],
    steps: [{ key: "step_1", text: "Mix batter" }],
    timeServings: { servings: 4, prepTime: "5", cookTime: "10" },
    nutrition: { calories: "200", protein: "6", carbs: "30", fat: "5" },
    tags: { cuisine: "American", dietTags: ["Vegetarian"] },
    setTitle: vi.fn(),
    setDescription: vi.fn(),
    setTimeServings: vi.fn(),
    setNutrition: vi.fn(),
    setTags: vi.fn(),
    addIngredient: vi.fn(),
    removeIngredient: vi.fn(),
    updateIngredient: vi.fn(),
    addStep: vi.fn(),
    removeStep: vi.fn(),
    updateStep: vi.fn(),
    moveStep: vi.fn(),
    ingredientsSummary: "1 ingredient",
    instructionsSummary: "Step 1: Mix batter",
    timeServingsSummary: "4 servings · 15 min",
    nutritionSummary: "200 cal · 6g protein",
    tagsSummary: "American, Vegetarian",
    isDirty: true,
    markDirty: vi.fn(),
    formToPayload: vi.fn(),
    ...overrides,
  } as unknown as Parameters<typeof PreviewStep>[0]["form"];
}

describe("PreviewStep — section edit labels (M21)", () => {
  it("uses unique accessibility labels per section (not duplicate 'Edit')", () => {
    const onEditStep = vi.fn();
    renderComponent(<PreviewStep form={makeForm()} onEditStep={onEditStep} />);

    // Every Edit button should have a label starting with "Edit " and
    // including the section label.
    const editButtons = screen
      .getAllByRole("button")
      .filter((b) => b.getAttribute("aria-label")?.startsWith("Edit "));

    expect(editButtons.length).toBeGreaterThanOrEqual(6);

    const labels = editButtons.map((b) => b.getAttribute("aria-label"));
    const unique = new Set(labels);
    // Unique labels prove each section has its own context.
    expect(unique.size).toBe(labels.length);
  });

  it("includes 'Edit Title' on the title row edit button", () => {
    renderComponent(<PreviewStep form={makeForm()} onEditStep={vi.fn()} />);
    expect(screen.getByLabelText("Edit Title")).toBeDefined();
  });

  it("includes section-specific labels for each preview section", () => {
    renderComponent(<PreviewStep form={makeForm()} onEditStep={vi.fn()} />);
    expect(screen.getByLabelText("Edit Time & Servings")).toBeDefined();
    expect(screen.getByLabelText("Edit Ingredients (1)")).toBeDefined();
    expect(screen.getByLabelText("Edit Instructions (1 step)")).toBeDefined();
    expect(screen.getByLabelText("Edit Nutrition")).toBeDefined();
    expect(screen.getByLabelText("Edit Tags")).toBeDefined();
  });

  it("pluralizes 'steps' in the Instructions edit label when count != 1", () => {
    renderComponent(
      <PreviewStep
        form={makeForm({
          steps: [
            { key: "step_1", text: "Mix batter" },
            { key: "step_2", text: "Bake" },
          ],
        })}
        onEditStep={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Edit Instructions (2 steps)")).toBeDefined();
  });

  it("calls onEditStep(1) when the title edit button is pressed", () => {
    const onEditStep = vi.fn();
    renderComponent(<PreviewStep form={makeForm()} onEditStep={onEditStep} />);
    fireEvent.click(screen.getByLabelText("Edit Title"));
    expect(onEditStep).toHaveBeenCalledWith(1);
  });

  it("calls onEditStep(5) when the Nutrition edit button is pressed", () => {
    const onEditStep = vi.fn();
    renderComponent(<PreviewStep form={makeForm()} onEditStep={onEditStep} />);
    fireEvent.click(screen.getByLabelText("Edit Nutrition"));
    expect(onEditStep).toHaveBeenCalledWith(5);
  });

  it("renders 'Not specified' when nutrition is empty", () => {
    renderComponent(
      <PreviewStep
        form={makeForm({
          nutrition: { calories: "", protein: "", carbs: "", fat: "" },
        })}
        onEditStep={vi.fn()}
      />,
    );
    expect(screen.getByText("Not specified")).toBeDefined();
  });

  it("renders macro values when nutrition is filled", () => {
    renderComponent(<PreviewStep form={makeForm()} onEditStep={vi.fn()} />);
    expect(screen.getByText("200")).toBeDefined();
    expect(screen.getByText("6g")).toBeDefined();
  });
});
