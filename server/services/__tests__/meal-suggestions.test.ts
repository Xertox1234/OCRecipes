import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  buildSuggestionCacheKey,
  buildDietaryContext,
  mealSuggestionSchema,
  aiResponseSchema,
  generateMealSuggestions,
} from "../meal-suggestions";
import type { MealSuggestionInput } from "../meal-suggestions";

import { openai } from "../../lib/openai";
import {
  createMockChatCompletion,
  createMockUserProfile,
} from "../../__tests__/factories";

vi.mock("../../lib/openai", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
  OPENAI_TIMEOUT_HEAVY_MS: 60_000,
}));

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
      const profile = createMockUserProfile({
        allergies: [{ name: "peanuts", severity: "severe" }],
      });
      const result = buildDietaryContext(profile);
      expect(result).toContain("Peanuts");
      expect(result).toContain("CRITICAL ALLERGY RESTRICTIONS");
      expect(result).toContain("SEVERE");
    });

    it("should include diet type", () => {
      const profile = createMockUserProfile({
        dietType: "vegetarian",
      });
      const result = buildDietaryContext(profile);
      expect(result).toContain("vegetarian");
    });

    it("should include food dislikes", () => {
      const profile = createMockUserProfile({
        foodDislikes: ["mushrooms", "olives"],
      });
      const result = buildDietaryContext(profile);
      expect(result).toContain("mushrooms");
      expect(result).toContain("olives");
    });

    it("should include cuisine preferences", () => {
      const profile = createMockUserProfile({
        cuisinePreferences: ["Italian", "Thai"],
      });
      const result = buildDietaryContext(profile);
      expect(result).toContain("Italian");
      expect(result).toContain("Thai");
    });

    it("should include cooking skill level", () => {
      const profile = createMockUserProfile({
        cookingSkillLevel: "beginner",
      });
      const result = buildDietaryContext(profile);
      expect(result).toContain("Cooking skill: beginner");
    });

    it("should include cooking time available", () => {
      const profile = createMockUserProfile({
        cookingTimeAvailable: "30 minutes",
      });
      const result = buildDietaryContext(profile);
      expect(result).toContain("Preferred cooking time: 30 minutes");
    });

    it("should return empty string for profile with no relevant fields", () => {
      const profile = createMockUserProfile();
      expect(buildDietaryContext(profile)).toBe("");
    });

    it("should combine all fields with periods", () => {
      const profile = createMockUserProfile({
        allergies: [{ name: "tree_nuts", severity: "moderate" }],
        dietType: "vegan",
        foodDislikes: ["onions"],
        cuisinePreferences: ["Japanese"],
        cookingSkillLevel: "intermediate",
        cookingTimeAvailable: "45 minutes",
      });
      const result = buildDietaryContext(profile);
      expect(result).toContain("CRITICAL ALLERGY RESTRICTIONS");
      expect(result).toContain("Tree Nuts");
      expect(result).toContain("Diet type: vegan");
      expect(result).toContain("Dislikes: onions");
      expect(result).toContain("Cuisine preferences: Japanese");
      expect(result).toContain("Cooking skill: intermediate");
      expect(result).toContain("Preferred cooking time: 45 minutes");
      expect(result.endsWith(".")).toBe(true);
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

  describe("generateMealSuggestions", () => {
    const mockCreate = vi.mocked(openai.chat.completions.create);

    const baseSuggestion = {
      title: "Grilled Chicken",
      description: "A simple grilled chicken",
      reasoning: "High protein, fits budget",
      calories: 350,
      protein: 40,
      carbs: 10,
      fat: 15,
      prepTimeMinutes: 25,
      difficulty: "Easy" as const,
      ingredients: [{ name: "chicken breast", quantity: "200", unit: "g" }],
      instructions: "1. Grill chicken.",
      dietTags: ["high-protein"],
    };

    const validAIResponse = {
      suggestions: [
        baseSuggestion,
        { ...baseSuggestion, title: "Salmon Bowl" },
        { ...baseSuggestion, title: "Veggie Wrap" },
      ],
    };

    const baseInput: MealSuggestionInput = {
      userId: "user1",
      date: "2025-01-15",
      mealType: "lunch",
      userProfile: null,
      dailyTargets: { calories: 2000, protein: 150, carbs: 200, fat: 70 },
      existingMeals: [],
      remainingBudget: { calories: 700, protein: 50, carbs: 80, fat: 25 },
    };

    beforeEach(() => {
      mockCreate.mockReset();
    });

    it("returns 3 validated suggestions from AI", async () => {
      mockCreate.mockResolvedValue(
        createMockChatCompletion(JSON.stringify(validAIResponse)),
      );

      const result = await generateMealSuggestions(baseInput);
      expect(result).toHaveLength(3);
      expect(result[0].title).toBe("Grilled Chicken");
      expect(result[1].title).toBe("Salmon Bowl");
      expect(result[2].title).toBe("Veggie Wrap");
    });

    it("includes existing meals in the prompt", async () => {
      mockCreate.mockResolvedValue(
        createMockChatCompletion(JSON.stringify(validAIResponse)),
      );

      const input: MealSuggestionInput = {
        ...baseInput,
        existingMeals: [
          { title: "Oatmeal", calories: 300, mealType: "breakfast" },
        ],
      };

      await generateMealSuggestions(input);

      const callArgs = mockCreate.mock.calls[0][0];
      const userMessage = callArgs.messages[1].content as string;
      expect(userMessage).toContain("Oatmeal");
      expect(userMessage).toContain("300 cal");
    });

    it("includes dietary context when userProfile is provided", async () => {
      mockCreate.mockResolvedValue(
        createMockChatCompletion(JSON.stringify(validAIResponse)),
      );

      const input: MealSuggestionInput = {
        ...baseInput,
        userProfile: createMockUserProfile({
          dietType: "vegan",
          allergies: [{ name: "gluten" }],
        }),
      };

      await generateMealSuggestions(input);

      const callArgs = mockCreate.mock.calls[0][0];
      const userMessage = callArgs.messages[1].content as string;
      expect(userMessage).toContain("DIETARY REQUIREMENTS");
      expect(userMessage).toContain("vegan");
      expect(userMessage).toContain("gluten");
    });

    it("throws user-friendly error on OpenAI API failure", async () => {
      mockCreate.mockRejectedValue(new Error("API timeout"));

      await expect(generateMealSuggestions(baseInput)).rejects.toThrow(
        "Failed to generate meal suggestions. Please try again.",
      );
    });

    it("throws when AI returns no content", async () => {
      mockCreate.mockResolvedValue(createMockChatCompletion(null));

      await expect(generateMealSuggestions(baseInput)).rejects.toThrow(
        "No response from AI",
      );
    });

    it("throws when AI returns invalid JSON", async () => {
      mockCreate.mockResolvedValue(createMockChatCompletion("not json"));

      await expect(generateMealSuggestions(baseInput)).rejects.toThrow(
        "AI returned invalid JSON response",
      );
    });

    it("throws when AI response fails schema validation", async () => {
      mockCreate.mockResolvedValue(
        createMockChatCompletion(
          JSON.stringify({ suggestions: [{ title: "Only one" }] }),
        ),
      );

      await expect(generateMealSuggestions(baseInput)).rejects.toThrow(
        /exactly 3 element/,
      );
    });

    it("uses 'No meals planned yet today' when existingMeals is empty", async () => {
      mockCreate.mockResolvedValue(
        createMockChatCompletion(JSON.stringify(validAIResponse)),
      );

      await generateMealSuggestions(baseInput);

      const callArgs = mockCreate.mock.calls[0][0];
      const userMessage = callArgs.messages[1].content as string;
      expect(userMessage).toContain("No meals planned yet today");
    });
  });
});
