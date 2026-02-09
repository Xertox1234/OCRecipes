import { describe, it, expect } from "vitest";
import {
  buildSuggestionCacheKey,
  buildDietaryContext,
  mealSuggestionSchema,
  aiResponseSchema,
} from "../meal-suggestions";
import type { UserProfile } from "@shared/schema";

describe("meal-suggestions", () => {
  describe("buildSuggestionCacheKey", () => {
    it("should produce a deterministic SHA-256 hex hash", () => {
      const key = buildSuggestionCacheKey(
        "user1",
        "2025-01-15",
        "lunch",
        "profile-hash",
        "plan-hash",
      );
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    it("should produce different keys for different inputs", () => {
      const key1 = buildSuggestionCacheKey(
        "user1",
        "2025-01-15",
        "lunch",
        "ph1",
        "plan1",
      );
      const key2 = buildSuggestionCacheKey(
        "user1",
        "2025-01-15",
        "dinner",
        "ph1",
        "plan1",
      );
      expect(key1).not.toBe(key2);
    });

    it("should produce the same key for identical inputs", () => {
      const key1 = buildSuggestionCacheKey(
        "user1",
        "2025-01-15",
        "lunch",
        "ph",
        "plan",
      );
      const key2 = buildSuggestionCacheKey(
        "user1",
        "2025-01-15",
        "lunch",
        "ph",
        "plan",
      );
      expect(key1).toBe(key2);
    });
  });

  describe("buildDietaryContext", () => {
    it("should return empty string for null profile", () => {
      expect(buildDietaryContext(null)).toBe("");
    });

    it("should include allergies when present", () => {
      const profile = {
        allergies: [{ name: "peanuts", severity: "severe" }],
      } as unknown as UserProfile;
      const result = buildDietaryContext(profile);
      expect(result).toContain("peanuts");
      expect(result).toContain("MUST AVOID");
    });

    it("should include diet type", () => {
      const profile = {
        dietType: "vegetarian",
        allergies: [],
        foodDislikes: [],
        cuisinePreferences: [],
      } as unknown as UserProfile;
      const result = buildDietaryContext(profile);
      expect(result).toContain("vegetarian");
    });

    it("should include food dislikes", () => {
      const profile = {
        allergies: [],
        foodDislikes: ["mushrooms", "olives"],
        cuisinePreferences: [],
      } as unknown as UserProfile;
      const result = buildDietaryContext(profile);
      expect(result).toContain("mushrooms");
      expect(result).toContain("olives");
    });

    it("should include cuisine preferences", () => {
      const profile = {
        allergies: [],
        foodDislikes: [],
        cuisinePreferences: ["Italian", "Thai"],
      } as unknown as UserProfile;
      const result = buildDietaryContext(profile);
      expect(result).toContain("Italian");
      expect(result).toContain("Thai");
    });
  });

  describe("mealSuggestionSchema", () => {
    it("should validate a valid suggestion", () => {
      const valid = {
        title: "Chicken Stir Fry",
        description: "A quick and healthy stir fry",
        reasoning: "Fits within remaining calorie budget",
        calories: 450,
        protein: 35,
        carbs: 40,
        fat: 15,
        prepTimeMinutes: 20,
        difficulty: "Easy",
        ingredients: [{ name: "chicken breast", quantity: "200", unit: "g" }],
        instructions: "1. Cook chicken. 2. Add vegetables.",
        dietTags: ["high-protein"],
      };
      expect(mealSuggestionSchema.parse(valid)).toEqual(valid);
    });

    it("should reject suggestion without title", () => {
      expect(() =>
        mealSuggestionSchema.parse({
          title: "",
          description: "desc",
          reasoning: "reason",
          calories: 100,
          protein: 10,
          carbs: 10,
          fat: 5,
          prepTimeMinutes: 10,
          difficulty: "Easy",
          ingredients: [{ name: "rice" }],
          instructions: "cook",
          dietTags: [],
        }),
      ).toThrow();
    });

    it("should reject invalid difficulty", () => {
      expect(() =>
        mealSuggestionSchema.parse({
          title: "Test",
          description: "desc",
          reasoning: "reason",
          calories: 100,
          protein: 10,
          carbs: 10,
          fat: 5,
          prepTimeMinutes: 10,
          difficulty: "Super Easy",
          ingredients: [{ name: "rice" }],
          instructions: "cook",
          dietTags: [],
        }),
      ).toThrow();
    });
  });

  describe("aiResponseSchema", () => {
    it("should require exactly 3 suggestions", () => {
      const makeSuggestion = (title: string) => ({
        title,
        description: "desc",
        reasoning: "reason",
        calories: 100,
        protein: 10,
        carbs: 20,
        fat: 5,
        prepTimeMinutes: 15,
        difficulty: "Easy" as const,
        ingredients: [{ name: "ingredient" }],
        instructions: "cook it",
        dietTags: [],
      });

      // Valid: 3 suggestions
      expect(() =>
        aiResponseSchema.parse({
          suggestions: [
            makeSuggestion("A"),
            makeSuggestion("B"),
            makeSuggestion("C"),
          ],
        }),
      ).not.toThrow();

      // Invalid: 2 suggestions
      expect(() =>
        aiResponseSchema.parse({
          suggestions: [makeSuggestion("A"), makeSuggestion("B")],
        }),
      ).toThrow();
    });
  });
});
