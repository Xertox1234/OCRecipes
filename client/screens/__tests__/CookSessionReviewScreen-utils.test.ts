import { describe, it, expect } from "vitest";
import {
  getNutritionAnnouncement,
  incompleteNutritionNote,
  logConfirmMessage,
} from "../CookSessionReviewScreen-utils";

describe("logConfirmMessage", () => {
  it("needs no confirmation when every ingredient was looked up and weighed", () => {
    expect(
      logConfirmMessage({ missedLookups: [], unweighedIngredients: [] }),
    ).toBeNull();
  });

  it("warns that missed lookups count as 0", () => {
    expect(
      logConfirmMessage({
        missedLookups: ["saffron"],
        unweighedIngredients: [],
      }),
    ).toBe(
      "No nutrition data was found for saffron. They will be counted as 0, so the logged meal will be too low. Log anyway?",
    );
  });

  it("warns that a count unit is counted as 100 g", () => {
    expect(
      logConfirmMessage({ missedLookups: [], unweighedIngredients: ["egg"] }),
    ).toBe(
      "egg has no weight, so it is counted as 100 g and the logged meal may be off. Log anyway?",
    );
  });

  it("names both problems when both apply", () => {
    const message = logConfirmMessage({
      missedLookups: ["saffron"],
      unweighedIngredients: ["egg", "garlic"],
    });
    expect(message).toContain("saffron");
    expect(message).toContain("egg, garlic have no weight");
  });

  it("treats a missing list (older server) as empty", () => {
    expect(logConfirmMessage({ missedLookups: [] })).toBeNull();
  });
});

describe("incompleteNutritionNote", () => {
  it("is null when nothing is missing", () => {
    expect(
      incompleteNutritionNote({ missedLookups: [], unweighedIngredients: [] }),
    ).toBeNull();
  });

  it("lists missed and unweighed ingredients", () => {
    expect(
      incompleteNutritionNote({
        missedLookups: ["saffron"],
        unweighedIngredients: ["egg"],
      }),
    ).toBe(
      "No nutrition data for saffron (counted as 0) • No weight for egg (counted as 100 g)",
    );
  });
});

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
