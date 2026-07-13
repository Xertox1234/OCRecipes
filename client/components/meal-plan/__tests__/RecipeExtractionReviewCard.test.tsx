// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import { renderComponent } from "../../../../test/utils/render-component";
import { RecipeExtractionReviewCard } from "../RecipeExtractionReviewCard";
import type { RecipePhotoResult } from "@/lib/photo-upload";

function makeResult(
  overrides: Partial<RecipePhotoResult> = {},
): RecipePhotoResult {
  return {
    title: "Pancakes",
    description: null,
    ingredients: [{ name: "Flour", quantity: "2", unit: "cup" }],
    instructions: null,
    servings: 4,
    prepTimeMinutes: 10,
    cookTimeMinutes: 15,
    cuisine: null,
    dietTags: [],
    caloriesPerServing: 250,
    proteinPerServing: 6,
    carbsPerServing: 40,
    fatPerServing: 8,
    confidence: 0.9,
    ...overrides,
  };
}

describe("RecipeExtractionReviewCard", () => {
  it("renders the title, servings, times, macros, and ingredient count", () => {
    renderComponent(
      <RecipeExtractionReviewCard result={makeResult()} onSave={vi.fn()} />,
    );

    expect(screen.getByText("Pancakes")).toBeTruthy();
    expect(screen.getByText("4 servings")).toBeTruthy();
    expect(screen.getByText("10m prep")).toBeTruthy();
    expect(screen.getByText("15m cook")).toBeTruthy();
    expect(screen.getByText("1 ingredient")).toBeTruthy();
  });

  it("calls onSave when the Review & Save button is pressed", () => {
    const onSave = vi.fn();
    renderComponent(
      <RecipeExtractionReviewCard result={makeResult()} onSave={onSave} />,
    );

    fireEvent.click(screen.getByLabelText("Review and save recipe"));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("shows a '+N more' line when there are more than 5 ingredients", () => {
    const ingredients = Array.from({ length: 7 }, (_, i) => ({
      name: `Ingredient ${i + 1}`,
      quantity: "1",
      unit: "cup",
    }));
    renderComponent(
      <RecipeExtractionReviewCard
        result={makeResult({ ingredients })}
        onSave={vi.fn()}
      />,
    );

    expect(screen.getByText("+2 more")).toBeTruthy();
  });
});
