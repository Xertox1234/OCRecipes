import { describe, it, expect } from "vitest";
import { getNutritionAnnouncement } from "../CookSessionReviewScreen-utils";

// Accessibility audit 2026-11-06 M4: the nutrition total arriving (or being
// recalculated after a preparation change) was silent.
describe("getNutritionAnnouncement", () => {
  const total = {
    calories: 520,
    protein: 30,
    carbs: 40,
    fat: 20,
    fiber: 5,
    sugar: 8,
    sodium: 400,
  };

  it("speaks the calculated total's calories and macros", () => {
    expect(getNutritionAnnouncement(total, "calculated")).toBe(
      "Nutrition calculated: 520 calories, 30 grams protein, 40 grams carbs, 20 grams fat.",
    );
  });

  it("says the total was updated after a recalculation", () => {
    expect(getNutritionAnnouncement(total, "updated")).toBe(
      "Nutrition updated: 520 calories, 30 grams protein, 40 grams carbs, 20 grams fat.",
    );
  });
});
