// @vitest-environment jsdom
/**
 * Section titles must carry the header role so VoiceOver's Headings rotor and
 * TalkBack's heading navigation can jump between sections. ThemedText adds it
 * only for type h1–h4; these titles use body-sized styles, so each call site
 * sets accessibilityRole="header" itself (2026-11-06 accessibility follow-up).
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderComponent } from "../../../test/utils/render-component";
import { NutritionCard } from "../recipe-detail/NutritionCard";
import { RecipeIngredientsList } from "../recipe-detail/RecipeIngredientsList";
import MicronutrientSummary from "../MicronutrientSummary";

vi.mock("@/components/IngredientIcon", () => ({ IngredientIcon: () => null }));
vi.mock("@/components/AllergenBadge", () => ({ AllergenBadge: () => null }));
vi.mock("@/components/InlineSubstitution", () => ({
  InlineSubstitution: () => null,
}));
vi.mock("@/components/AllergenWarningBanner", () => ({
  AllergenWarningBanner: () => null,
}));

// "header" is RN's role name, not an ARIA one, so Testing Library computes no
// accessible name from its text — compare the headings' text directly.
const headings = () =>
  screen.queryAllByRole("header").map((h) => h.textContent ?? "");

describe("section titles are headings", () => {
  it("recipe nutrition card", () => {
    renderComponent(
      <NutritionCard nutrition={{ calories: 420, protein: 30 }} />,
    );
    expect(headings()).toContain("Nutrition per serving");
  });

  it("recipe ingredients list", () => {
    renderComponent(<RecipeIngredientsList ingredients={[{ name: "oats" }]} />);
    expect(headings()).toContain("Ingredients");
  });

  it("micronutrient summary groups", () => {
    renderComponent(
      <MicronutrientSummary
        micronutrients={[
          {
            nutrientName: "Vitamin C",
            amount: 30,
            unit: "mg",
            percentDailyValue: 33,
          },
          {
            nutrientName: "Iron",
            amount: 4,
            unit: "mg",
            percentDailyValue: 22,
          },
        ]}
      />,
    );
    expect(headings()).toEqual(
      expect.arrayContaining(["Vitamins", "Minerals"]),
    );
  });
});
