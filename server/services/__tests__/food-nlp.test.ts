import { parseNaturalLanguageFood } from "../food-nlp";

// Mock OpenAI
vi.mock("../../lib/openai", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
}));

// Mock nutrition lookup
vi.mock("../nutrition-lookup", () => ({
  lookupNutrition: vi.fn(),
}));

// Mock ai-safety (pass through)
vi.mock("../../lib/ai-safety", () => ({
  sanitizeUserInput: vi.fn((text: string) => text),
  validateAiResponse: vi.fn((data: any, schema: any) => {
    const result = schema.safeParse(data);
    return result.success ? result.data : null;
  }),
  SYSTEM_PROMPT_BOUNDARY: "---BOUNDARY---",
}));

import { openai } from "../../lib/openai";
import { lookupNutrition } from "../nutrition-lookup";

const mockCreate = vi.mocked(openai.chat.completions.create);
const mockLookup = vi.mocked(lookupNutrition);

describe("Food NLP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseNaturalLanguageFood", () => {
    it("parses a simple food description into structured items", async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                items: [{ name: "egg", quantity: 2, unit: "large" }],
              }),
            },
          },
        ],
      } as any);

      mockLookup.mockResolvedValue({
        productName: "Egg",
        calories: "70",
        protein: "6",
        carbs: "1",
        fat: "5",
        servingSize: "1 large",
      } as any);

      const result = await parseNaturalLanguageFood("2 eggs");

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("egg");
      expect(result[0].quantity).toBe(2);
      expect(result[0].unit).toBe("large");
      // Calories multiplied by quantity: 70 * 2 = 140
      expect(result[0].calories).toBe(140);
      expect(result[0].protein).toBe(12);
    });

    it("handles multiple food items", async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                items: [
                  { name: "toast", quantity: 1, unit: "slice" },
                  { name: "butter", quantity: 1, unit: "tablespoon" },
                ],
              }),
            },
          },
        ],
      } as any);

      mockLookup.mockResolvedValue({
        productName: "Food",
        calories: "100",
        protein: "3",
        carbs: "15",
        fat: "4",
        servingSize: "1 serving",
      } as any);

      const result = await parseNaturalLanguageFood("toast with butter");

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("toast");
      expect(result[1].name).toBe("butter");
    });

    it("returns empty array when OpenAI returns no content", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
      } as any);

      const result = await parseNaturalLanguageFood("some food");

      expect(result).toEqual([]);
    });

    it("handles nutrition lookup failure gracefully", async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                items: [{ name: "exotic fruit", quantity: 1, unit: "piece" }],
              }),
            },
          },
        ],
      } as any);

      mockLookup.mockRejectedValue(new Error("Lookup failed"));

      const result = await parseNaturalLanguageFood("exotic fruit");

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("exotic fruit");
      expect(result[0].calories).toBeNull();
      expect(result[0].protein).toBeNull();
      expect(result[0].carbs).toBeNull();
      expect(result[0].fat).toBeNull();
    });

    it("sets fallback serving size when nutrition lookup fails", async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                items: [{ name: "mystery food", quantity: 3, unit: "cups" }],
              }),
            },
          },
        ],
      } as any);

      mockLookup.mockRejectedValue(new Error("Not found"));

      const result = await parseNaturalLanguageFood("3 cups of mystery food");

      expect(result[0].servingSize).toBe("3 cups");
    });

    it("uses nutrition servingSize when available", async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                items: [{ name: "rice", quantity: 1, unit: "cup" }],
              }),
            },
          },
        ],
      } as any);

      mockLookup.mockResolvedValue({
        productName: "Rice",
        calories: "200",
        protein: "4",
        carbs: "45",
        fat: "0.4",
        servingSize: "1 cup cooked",
      } as any);

      const result = await parseNaturalLanguageFood("a cup of rice");

      expect(result[0].servingSize).toBe("1 cup cooked");
    });

    it("returns empty array for invalid AI response", async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({ notItems: "wrong format" }),
            },
          },
        ],
      } as any);

      const result = await parseNaturalLanguageFood("some food");

      expect(result).toEqual([]);
    });
  });
});
