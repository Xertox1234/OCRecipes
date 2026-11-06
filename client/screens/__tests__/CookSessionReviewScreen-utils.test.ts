import { describe, it, expect } from "vitest";
import {
  logConfirmMessage,
  incompleteNutritionNote,
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
