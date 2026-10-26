// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import NutritionStep from "../NutritionStep";
import {
  hasAnyNutritionValue,
  sanitizeNumericInput,
} from "../nutrition-step-utils";
import { parseDecimalInput } from "@/lib/number-input";

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe("sanitizeNumericInput", () => {
  it("strips non-digit / non-decimal characters", () => {
    expect(sanitizeNumericInput("12a3b")).toBe("123");
  });

  it("allows a single decimal point", () => {
    expect(sanitizeNumericInput("3.14")).toBe("3.14");
  });

  it("collapses multiple decimal points after the first", () => {
    expect(sanitizeNumericInput("1.2.3")).toBe("1.23");
  });

  it("returns an empty string when all characters are non-numeric", () => {
    expect(sanitizeNumericInput("abc")).toBe("");
  });

  // A comma-decimal keypad sends ",": stripping it turned 12,5 into 125.
  it("treats a comma as the decimal separator", () => {
    expect(sanitizeNumericInput("12,5")).toBe("12.5");
    expect(sanitizeNumericInput("12.5")).toBe("12.5");
    expect(parseDecimalInput(sanitizeNumericInput("12,5"))).toBe(12.5);
    expect(parseDecimalInput(sanitizeNumericInput("12.5"))).toBe(12.5);
  });

  it("keeps only the first separator, comma or point", () => {
    expect(sanitizeNumericInput("1,2.3")).toBe("1.23");
    expect(sanitizeNumericInput("1.2,3")).toBe("1.23");
  });

  it("returns empty input unchanged (skip flow)", () => {
    expect(sanitizeNumericInput("")).toBe("");
  });
});

describe("hasAnyNutritionValue", () => {
  it("returns false when every field is empty", () => {
    expect(
      hasAnyNutritionValue({
        calories: "",
        protein: "",
        carbs: "",
        fat: "",
      }),
    ).toBe(false);
  });

  it("returns true when only calories is filled", () => {
    expect(
      hasAnyNutritionValue({
        calories: "200",
        protein: "",
        carbs: "",
        fat: "",
      }),
    ).toBe(true);
  });

  it("returns true when only fat is filled", () => {
    expect(
      hasAnyNutritionValue({
        calories: "",
        protein: "",
        carbs: "",
        fat: "5",
      }),
    ).toBe(true);
  });
});

// ── Rendered NutritionStep ───────────────────────────────────────────────────

function makeNutrition(overrides?: Partial<Record<string, string>>) {
  return {
    calories: "",
    protein: "",
    carbs: "",
    fat: "",
    ...overrides,
  } as {
    calories: string;
    protein: string;
    carbs: string;
    fat: string;
  };
}

describe("NutritionStep — render", () => {
  it("renders all four macro fields with accessibility labels", () => {
    renderComponent(
      <NutritionStep nutrition={makeNutrition()} setNutrition={vi.fn()} />,
    );
    expect(screen.getByLabelText("calories per serving")).toBeDefined();
    expect(screen.getByLabelText("protein per serving")).toBeDefined();
    expect(screen.getByLabelText("carbs per serving")).toBeDefined();
    expect(screen.getByLabelText("fat per serving")).toBeDefined();
  });

  it("renders pre-filled values (skip flow accepts empty strings)", () => {
    renderComponent(
      <NutritionStep
        nutrition={makeNutrition({ calories: "250", protein: "10" })}
        setNutrition={vi.fn()}
      />,
    );
    const calories = screen.getByLabelText(
      "calories per serving",
    ) as HTMLInputElement;
    const protein = screen.getByLabelText(
      "protein per serving",
    ) as HTMLInputElement;
    const carbs = screen.getByLabelText(
      "carbs per serving",
    ) as HTMLInputElement;
    expect(calories.value).toBe("250");
    expect(protein.value).toBe("10");
    expect(carbs.value).toBe("");
  });

  it("sanitizes alphabetic characters out of user input before updating", () => {
    const setNutrition = vi.fn();
    renderComponent(
      <NutritionStep nutrition={makeNutrition()} setNutrition={setNutrition} />,
    );
    fireEvent.change(screen.getByLabelText("calories per serving"), {
      target: { value: "2a5b0" },
    });
    expect(setNutrition).toHaveBeenCalledWith(
      expect.objectContaining({ calories: "250" }),
    );
  });

  it("allows a single decimal point when editing grams", () => {
    const setNutrition = vi.fn();
    renderComponent(
      <NutritionStep nutrition={makeNutrition()} setNutrition={setNutrition} />,
    );
    fireEvent.change(screen.getByLabelText("protein per serving"), {
      target: { value: "12.5" },
    });
    expect(setNutrition).toHaveBeenCalledWith(
      expect.objectContaining({ protein: "12.5" }),
    );
  });

  it("preserves other fields when editing a single macro (immutable update)", () => {
    const setNutrition = vi.fn();
    renderComponent(
      <NutritionStep
        nutrition={makeNutrition({ protein: "20", carbs: "40", fat: "5" })}
        setNutrition={setNutrition}
      />,
    );
    fireEvent.change(screen.getByLabelText("calories per serving"), {
      target: { value: "300" },
    });
    expect(setNutrition).toHaveBeenCalledWith({
      calories: "300",
      protein: "20",
      carbs: "40",
      fat: "5",
    });
  });
});
