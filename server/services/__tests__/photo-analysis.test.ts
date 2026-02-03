import { describe, it, expect } from "vitest";
import { z } from "zod";

// Re-create the schemas here for testing (same as in photo-analysis.ts)
// This avoids importing the entire module with OpenAI dependencies
const foodItemSchema = z.object({
  name: z.string(),
  quantity: z.string(),
  confidence: z.number().min(0).max(1),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().optional(),
});

const analysisResultSchema = z.object({
  foods: z.array(foodItemSchema),
  overallConfidence: z.number().min(0).max(1),
  followUpQuestions: z.array(z.string()),
});

describe("Photo Analysis Schemas", () => {
  describe("foodItemSchema", () => {
    it("validates a complete food item", () => {
      const validItem = {
        name: "grilled chicken breast",
        quantity: "6 oz",
        confidence: 0.85,
        needsClarification: false,
      };

      const result = foodItemSchema.safeParse(validItem);
      expect(result.success).toBe(true);
    });

    it("validates a food item with clarification question", () => {
      const validItem = {
        name: "rice",
        quantity: "1 cup",
        confidence: 0.5,
        needsClarification: true,
        clarificationQuestion: "Is this white rice or brown rice?",
      };

      const result = foodItemSchema.safeParse(validItem);
      expect(result.success).toBe(true);
    });

    it("accepts clarificationQuestion as optional", () => {
      const validItem = {
        name: "apple",
        quantity: "1 medium",
        confidence: 0.95,
        needsClarification: false,
      };

      const result = foodItemSchema.safeParse(validItem);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.clarificationQuestion).toBeUndefined();
      }
    });

    it("rejects missing name", () => {
      const invalidItem = {
        quantity: "1 cup",
        confidence: 0.8,
        needsClarification: false,
      };

      const result = foodItemSchema.safeParse(invalidItem);
      expect(result.success).toBe(false);
    });

    it("rejects missing quantity", () => {
      const invalidItem = {
        name: "chicken",
        confidence: 0.8,
        needsClarification: false,
      };

      const result = foodItemSchema.safeParse(invalidItem);
      expect(result.success).toBe(false);
    });

    it("rejects confidence below 0", () => {
      const invalidItem = {
        name: "salad",
        quantity: "1 bowl",
        confidence: -0.1,
        needsClarification: false,
      };

      const result = foodItemSchema.safeParse(invalidItem);
      expect(result.success).toBe(false);
    });

    it("rejects confidence above 1", () => {
      const invalidItem = {
        name: "salad",
        quantity: "1 bowl",
        confidence: 1.5,
        needsClarification: false,
      };

      const result = foodItemSchema.safeParse(invalidItem);
      expect(result.success).toBe(false);
    });

    it("accepts confidence at boundary values 0 and 1", () => {
      const minConfidence = {
        name: "unknown food",
        quantity: "some",
        confidence: 0,
        needsClarification: true,
      };

      const maxConfidence = {
        name: "water",
        quantity: "1 glass",
        confidence: 1,
        needsClarification: false,
      };

      expect(foodItemSchema.safeParse(minConfidence).success).toBe(true);
      expect(foodItemSchema.safeParse(maxConfidence).success).toBe(true);
    });

    it("rejects missing needsClarification", () => {
      const invalidItem = {
        name: "pasta",
        quantity: "2 cups",
        confidence: 0.7,
      };

      const result = foodItemSchema.safeParse(invalidItem);
      expect(result.success).toBe(false);
    });

    it("rejects non-boolean needsClarification", () => {
      const invalidItem = {
        name: "pasta",
        quantity: "2 cups",
        confidence: 0.7,
        needsClarification: "yes",
      };

      const result = foodItemSchema.safeParse(invalidItem);
      expect(result.success).toBe(false);
    });
  });

  describe("analysisResultSchema", () => {
    it("validates a complete analysis result", () => {
      const validResult = {
        foods: [
          {
            name: "grilled chicken",
            quantity: "6 oz",
            confidence: 0.9,
            needsClarification: false,
          },
          {
            name: "steamed broccoli",
            quantity: "1 cup",
            confidence: 0.85,
            needsClarification: false,
          },
        ],
        overallConfidence: 0.87,
        followUpQuestions: [],
      };

      const result = analysisResultSchema.safeParse(validResult);
      expect(result.success).toBe(true);
    });

    it("validates result with follow-up questions", () => {
      const validResult = {
        foods: [
          {
            name: "rice",
            quantity: "1 cup",
            confidence: 0.6,
            needsClarification: true,
            clarificationQuestion: "What type of rice is this?",
          },
        ],
        overallConfidence: 0.6,
        followUpQuestions: [
          "Is this white rice or brown rice?",
          "Approximately how much oil was used for cooking?",
        ],
      };

      const result = analysisResultSchema.safeParse(validResult);
      expect(result.success).toBe(true);
    });

    it("validates result with empty foods array", () => {
      const validResult = {
        foods: [],
        overallConfidence: 0,
        followUpQuestions: ["Could not identify any foods in the image."],
      };

      const result = analysisResultSchema.safeParse(validResult);
      expect(result.success).toBe(true);
    });

    it("rejects missing foods array", () => {
      const invalidResult = {
        overallConfidence: 0.8,
        followUpQuestions: [],
      };

      const result = analysisResultSchema.safeParse(invalidResult);
      expect(result.success).toBe(false);
    });

    it("rejects missing overallConfidence", () => {
      const invalidResult = {
        foods: [],
        followUpQuestions: [],
      };

      const result = analysisResultSchema.safeParse(invalidResult);
      expect(result.success).toBe(false);
    });

    it("rejects missing followUpQuestions array", () => {
      const invalidResult = {
        foods: [],
        overallConfidence: 0.5,
      };

      const result = analysisResultSchema.safeParse(invalidResult);
      expect(result.success).toBe(false);
    });

    it("rejects overallConfidence below 0", () => {
      const invalidResult = {
        foods: [],
        overallConfidence: -0.5,
        followUpQuestions: [],
      };

      const result = analysisResultSchema.safeParse(invalidResult);
      expect(result.success).toBe(false);
    });

    it("rejects overallConfidence above 1", () => {
      const invalidResult = {
        foods: [],
        overallConfidence: 1.2,
        followUpQuestions: [],
      };

      const result = analysisResultSchema.safeParse(invalidResult);
      expect(result.success).toBe(false);
    });

    it("rejects invalid food item in foods array", () => {
      const invalidResult = {
        foods: [
          {
            name: "chicken",
            // missing quantity and other required fields
          },
        ],
        overallConfidence: 0.8,
        followUpQuestions: [],
      };

      const result = analysisResultSchema.safeParse(invalidResult);
      expect(result.success).toBe(false);
    });

    it("rejects non-string in followUpQuestions", () => {
      const invalidResult = {
        foods: [],
        overallConfidence: 0.5,
        followUpQuestions: [123, "valid question"],
      };

      const result = analysisResultSchema.safeParse(invalidResult);
      expect(result.success).toBe(false);
    });

    it("handles typical GPT-4o Vision response format", () => {
      // This simulates what GPT-4o Vision might return
      const gptResponse = {
        foods: [
          {
            name: "grilled salmon fillet",
            quantity: "4 oz",
            confidence: 0.92,
            needsClarification: false,
          },
          {
            name: "mixed green salad",
            quantity: "2 cups",
            confidence: 0.88,
            needsClarification: false,
          },
          {
            name: "dressing",
            quantity: "2 tbsp",
            confidence: 0.65,
            needsClarification: true,
            clarificationQuestion:
              "What type of dressing is on the salad (ranch, vinaigrette, etc.)?",
          },
        ],
        overallConfidence: 0.82,
        followUpQuestions: [],
      };

      const result = analysisResultSchema.safeParse(gptResponse);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.foods).toHaveLength(3);
        expect(result.data.foods[2].clarificationQuestion).toBe(
          "What type of dressing is on the salad (ranch, vinaigrette, etc.)?",
        );
      }
    });
  });

  describe("Real-world scenarios", () => {
    it("handles high confidence meal analysis", () => {
      const result = {
        foods: [
          {
            name: "bacon cheeseburger",
            quantity: "1 burger",
            confidence: 0.95,
            needsClarification: false,
          },
          {
            name: "french fries",
            quantity: "medium serving",
            confidence: 0.92,
            needsClarification: false,
          },
          {
            name: "cola",
            quantity: "16 oz",
            confidence: 0.98,
            needsClarification: false,
          },
        ],
        overallConfidence: 0.95,
        followUpQuestions: [],
      };

      expect(analysisResultSchema.safeParse(result).success).toBe(true);
    });

    it("handles low confidence with follow-up questions", () => {
      const result = {
        foods: [
          {
            name: "stir fry",
            quantity: "1 plate",
            confidence: 0.55,
            needsClarification: true,
            clarificationQuestion: "What protein is in the stir fry?",
          },
        ],
        overallConfidence: 0.55,
        followUpQuestions: [
          "I can see a stir fry dish. What meat or protein does it contain?",
          "Is there any sauce or oil visible?",
        ],
      };

      expect(analysisResultSchema.safeParse(result).success).toBe(true);
    });

    it("handles error/fallback response format", () => {
      const errorResult = {
        foods: [],
        overallConfidence: 0,
        followUpQuestions: ["Could not analyze the image. Please try again."],
      };

      expect(analysisResultSchema.safeParse(errorResult).success).toBe(true);
    });
  });
});
