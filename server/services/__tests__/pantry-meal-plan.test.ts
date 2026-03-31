import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateMealPlanFromPantry,
  generatedMealSchema,
  aiResponseSchema,
} from "../pantry-meal-plan";
import type { PantryMealPlanInput } from "../pantry-meal-plan";

import { openai } from "../../lib/openai";
import {
  createMockPantryItem,
  createMockUserProfile,
  createMockChatCompletion,
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

const BASE_INPUT: PantryMealPlanInput = {
  pantryItems: [
    createMockPantryItem({
      userId: "user1",
      name: "Chicken Breast",
      quantity: "2",
      unit: "lb",
      category: "meat",
      expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
    }),
    createMockPantryItem({
      id: 2,
      name: "Brown Rice",
      quantity: "3",
      unit: "cups",
      category: "grains",
      expiresAt: null,
    }),
    createMockPantryItem({
      id: 3,
      name: "Broccoli",
      quantity: "1",
      unit: "bunch",
      category: "produce",
      expiresAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
    }),
  ],
  userProfile: null,
  dailyTargets: { calories: 2000, protein: 150, carbs: 250, fat: 67 },
  days: 3,
  householdSize: 1,
};

const VALID_AI_RESPONSE = {
  days: [
    {
      dayNumber: 1,
      meals: [
        {
          mealType: "breakfast",
          title: "Rice Bowl",
          description: "Simple rice and egg bowl",
          servings: 1,
          prepTimeMinutes: 5,
          cookTimeMinutes: 15,
          difficulty: "Easy",
          ingredients: [{ name: "Brown Rice", quantity: "1", unit: "cup" }],
          instructions: "1. Cook rice\n2. Top with egg",
          dietTags: ["high-fiber"],
          caloriesPerServing: 350,
          proteinPerServing: 12,
          carbsPerServing: 55,
          fatPerServing: 8,
        },
        {
          mealType: "lunch",
          title: "Chicken Stir Fry",
          description: "Quick chicken and broccoli stir fry",
          servings: 1,
          prepTimeMinutes: 10,
          cookTimeMinutes: 15,
          difficulty: "Easy",
          ingredients: [
            { name: "Chicken Breast", quantity: "6", unit: "oz" },
            { name: "Broccoli", quantity: "1", unit: "cup" },
          ],
          instructions: "1. Slice chicken\n2. Stir fry with broccoli",
          dietTags: ["high-protein"],
          caloriesPerServing: 450,
          proteinPerServing: 45,
          carbsPerServing: 15,
          fatPerServing: 12,
        },
        {
          mealType: "dinner",
          title: "Grilled Chicken with Rice",
          description: "Seasoned chicken with brown rice",
          servings: 1,
          prepTimeMinutes: 10,
          cookTimeMinutes: 25,
          difficulty: "Medium",
          ingredients: [
            { name: "Chicken Breast", quantity: "8", unit: "oz" },
            { name: "Brown Rice", quantity: "1", unit: "cup" },
          ],
          instructions: "1. Season chicken\n2. Grill\n3. Serve with rice",
          dietTags: ["high-protein"],
          caloriesPerServing: 550,
          proteinPerServing: 50,
          carbsPerServing: 55,
          fatPerServing: 12,
        },
      ],
    },
  ],
};

describe("pantry-meal-plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("aiResponseSchema", () => {
    it("should validate a well-formed AI response", () => {
      const result = aiResponseSchema.safeParse(VALID_AI_RESPONSE);
      expect(result.success).toBe(true);
    });

    it("should reject response with no days", () => {
      const result = aiResponseSchema.safeParse({ days: [] });
      expect(result.success).toBe(false);
    });

    it("should reject response with no meals in a day", () => {
      const result = aiResponseSchema.safeParse({
        days: [{ dayNumber: 1, meals: [] }],
      });
      expect(result.success).toBe(false);
    });

    it("should accept instructions as array and preserve as string[]", () => {
      const modified = {
        ...VALID_AI_RESPONSE,
        days: [
          {
            ...VALID_AI_RESPONSE.days[0],
            meals: [
              {
                ...VALID_AI_RESPONSE.days[0].meals[0],
                instructions: ["Step 1", "Step 2"],
              },
            ],
          },
        ],
      };
      const result = aiResponseSchema.safeParse(modified);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.days[0].meals[0].instructions).toEqual([
          "Step 1",
          "Step 2",
        ]);
      }
    });
  });

  describe("generatedMealSchema", () => {
    it("should validate a single meal", () => {
      const result = generatedMealSchema.safeParse(
        VALID_AI_RESPONSE.days[0].meals[0],
      );
      expect(result.success).toBe(true);
    });

    it("should reject meal with invalid mealType", () => {
      const result = generatedMealSchema.safeParse({
        ...VALID_AI_RESPONSE.days[0].meals[0],
        mealType: "brunch",
      });
      expect(result.success).toBe(false);
    });

    it("should reject meal with negative calories", () => {
      const result = generatedMealSchema.safeParse({
        ...VALID_AI_RESPONSE.days[0].meals[0],
        caloriesPerServing: -100,
      });
      expect(result.success).toBe(false);
    });
  });

  describe("generateMealPlanFromPantry", () => {
    it("should throw if pantry is empty", async () => {
      await expect(
        generateMealPlanFromPantry({
          ...BASE_INPUT,
          pantryItems: [],
        }),
      ).rejects.toThrow("No pantry items available");
    });

    it("should return a valid plan when AI responds correctly", async () => {
      vi.mocked(openai.chat.completions.create).mockResolvedValue(
        createMockChatCompletion(JSON.stringify(VALID_AI_RESPONSE)),
      );

      const result = await generateMealPlanFromPantry(BASE_INPUT);

      expect(result.days).toHaveLength(1);
      expect(result.days[0].meals).toHaveLength(3);
      expect(result.days[0].meals[0].title).toBe("Rice Bowl");
    });

    it("should throw if AI returns empty content", async () => {
      vi.mocked(openai.chat.completions.create).mockResolvedValue(
        createMockChatCompletion(null),
      );

      await expect(generateMealPlanFromPantry(BASE_INPUT)).rejects.toThrow(
        "No response from AI",
      );
    });

    it("should throw if AI returns invalid JSON", async () => {
      vi.mocked(openai.chat.completions.create).mockResolvedValue(
        createMockChatCompletion("not json"),
      );

      await expect(generateMealPlanFromPantry(BASE_INPUT)).rejects.toThrow(
        "AI returned invalid JSON response",
      );
    });

    it("should throw if OpenAI API fails", async () => {
      vi.mocked(openai.chat.completions.create).mockRejectedValue(
        new Error("API timeout"),
      );

      await expect(generateMealPlanFromPantry(BASE_INPUT)).rejects.toThrow(
        "Failed to generate meal plan",
      );
    });

    it("should call OpenAI with correct parameters", async () => {
      vi.mocked(openai.chat.completions.create).mockResolvedValue(
        createMockChatCompletion(JSON.stringify(VALID_AI_RESPONSE)),
      );

      await generateMealPlanFromPantry(BASE_INPUT);

      expect(openai.chat.completions.create).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(openai.chat.completions.create).mock
        .calls[0][0] as {
        model: string;
        response_format: { type: string };
        messages: { content: string }[];
      };
      expect(callArgs.model).toBe("gpt-4o");
      expect(callArgs.response_format).toEqual({ type: "json_object" });

      // Verify pantry items appear in the prompt
      const userMessage = callArgs.messages[1].content;
      expect(userMessage).toContain("Chicken Breast");
      expect(userMessage).toContain("Brown Rice");
      expect(userMessage).toContain("Broccoli");
      expect(userMessage).toContain("3-day");
    });

    it("should include dietary context when profile is provided", async () => {
      vi.mocked(openai.chat.completions.create).mockResolvedValue(
        createMockChatCompletion(JSON.stringify(VALID_AI_RESPONSE)),
      );

      const inputWithProfile: PantryMealPlanInput = {
        ...BASE_INPUT,
        userProfile: createMockUserProfile({
          userId: "user1",
          allergies: [{ name: "peanuts", severity: "severe" }],
          dietType: "vegetarian",
          cookingSkillLevel: "beginner",
          cookingTimeAvailable: "30 min",
          cuisinePreferences: ["Italian"],
          householdSize: 2,
        }),
      };

      await generateMealPlanFromPantry(inputWithProfile);

      const userMessage = (
        vi.mocked(openai.chat.completions.create).mock.calls[0][0] as {
          messages: { content: string }[];
        }
      ).messages[1].content;
      expect(userMessage).toContain("Peanuts");
      expect(userMessage).toContain("CRITICAL ALLERGY RESTRICTIONS");
      expect(userMessage).toContain("vegetarian");
    });

    it("should indicate expiring items in the prompt", async () => {
      vi.mocked(openai.chat.completions.create).mockResolvedValue(
        createMockChatCompletion(JSON.stringify(VALID_AI_RESPONSE)),
      );

      const expiringInput: PantryMealPlanInput = {
        ...BASE_INPUT,
        pantryItems: [
          createMockPantryItem({
            name: "Fresh Salmon",
            expiresAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), // 1 day
          }),
        ],
      };

      await generateMealPlanFromPantry(expiringInput);

      const userMessage = (
        vi.mocked(openai.chat.completions.create).mock.calls[0][0] as {
          messages: { content: string }[];
        }
      ).messages[1].content;
      expect(userMessage).toContain("EXPIRES");
    });
  });
});
