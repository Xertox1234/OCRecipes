import { parseNaturalLanguageFood } from "../food-nlp";

import { aiChat } from "../../lib/ai-client";
import { lookupNutrition, type NutritionData } from "../nutrition-lookup";

// Mock OpenAI
vi.mock("../../lib/ai-client", () => ({ aiChat: vi.fn() }));
vi.mock("../../lib/openai", () => ({
  OPENAI_TIMEOUT_FAST_MS: 15_000,
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

const mockCreate = vi.mocked(aiChat);
const mockLookup = vi.mocked(lookupNutrition);

type LlmItem = Record<string, unknown>;

function mockLlmItems(items: LlmItem[]) {
  mockCreate.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ items }) } }],
  } as any);
}

/** A CNF/USDA-shaped result: values per 100 g, labelled "100g". */
function per100g(
  calories: number,
  protein: number,
  carbs: number,
  fat: number,
  servingSize = "100g",
): NutritionData {
  return {
    name: "Reference food",
    calories,
    protein,
    carbs,
    fat,
    fiber: 0,
    sugar: 0,
    sodium: 0,
    servingSize,
    source: "cnf",
  };
}

describe("Food NLP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("parseNaturalLanguageFood", () => {
    it("parses a simple food description into structured items", async () => {
      mockLlmItems([{ name: "egg", quantity: 2, unit: "large", grams: 100 }]);
      mockLookup.mockResolvedValue(per100g(143, 12.6, 0.7, 9.5));

      const result = await parseNaturalLanguageFood("2 eggs");

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("egg");
      expect(result[0].quantity).toBe(2);
      expect(result[0].unit).toBe("large");
      expect(result[0].calories).toBe(143);
      expect(result[0].protein).toBe(12.6);
      expect(mockCreate.mock.calls[0][0]).toBe("food-nlp-parse");
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

    it("throws when OpenAI returns no content", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
      } as any);

      await expect(parseNaturalLanguageFood("some food")).rejects.toThrow(
        "No response from food parsing",
      );
    });

    it("returns empty array when the AI parses no foods (valid empty result)", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ items: [] }) } }],
      } as any);

      const result = await parseNaturalLanguageFood("uhh");

      expect(result).toEqual([]);
      expect(mockLookup).not.toHaveBeenCalled();
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

    it("throws on OpenAI API error", async () => {
      mockCreate.mockRejectedValue(new Error("API timeout"));

      await expect(parseNaturalLanguageFood("2 eggs")).rejects.toThrow(
        "Failed to parse food description. Please try again.",
      );
    });

    it("throws when AI returns invalid JSON", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "not valid json {{{" } }],
      } as any);

      await expect(parseNaturalLanguageFood("some food")).rejects.toThrow(
        "Food parsing returned invalid data. Please try again.",
      );
    });

    it("throws for invalid AI response shape", async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({ notItems: "wrong format" }),
            },
          },
        ],
      } as any);

      await expect(parseNaturalLanguageFood("some food")).rejects.toThrow(
        "Food parsing returned unexpected data. Please try again.",
      );
    });
  });

  describe("portion scaling", () => {
    it("scales a per-100 g result to the portion's estimated grams", async () => {
      mockLlmItems([{ name: "egg", quantity: 2, unit: "large", grams: 120 }]);
      mockLookup.mockResolvedValue(per100g(143, 12.6, 0.7, 9.5));

      const [egg] = await parseNaturalLanguageFood("2 eggs");

      expect(egg.calories).toBe(172); // 143 * 1.2 = 171.6
      expect(egg.protein).toBe(15.1);
      expect(egg.carbs).toBe(0.8);
      expect(egg.fat).toBe(11.4);
      expect(egg.servingSize).toBe("2 large (120 g)");
    });

    it("looks up the food by its lookup name, never by the quantity string", async () => {
      mockLlmItems([
        {
          name: "egg",
          lookupName: "egg, chicken, whole, cooked",
          quantity: 2,
          unit: "large",
          grams: 100,
        },
        { name: "banana", quantity: 1, unit: "medium", grams: 118 },
      ]);
      mockLookup.mockResolvedValue(per100g(100, 1, 1, 1));

      await parseNaturalLanguageFood("2 eggs and a banana");

      expect(mockLookup).toHaveBeenCalledWith("egg, chicken, whole, cooked");
      // No lookupName → falls back to the plain name, still without quantity
      expect(mockLookup).toHaveBeenCalledWith("banana");
      expect(mockLookup).toHaveBeenCalledTimes(2);
    });

    it("does not double-scale a per-serving result (API Ninjas)", async () => {
      mockLlmItems([{ name: "rice", quantity: 1, unit: "cup", grams: 125 }]);
      // 250 g serving holding 325 kcal → 130 kcal per 100 g
      mockLookup.mockResolvedValue({
        ...per100g(325, 6.5, 70, 0.8, "250g"),
        source: "api-ninjas",
      });

      const [rice] = await parseNaturalLanguageFood("a cup of rice");

      expect(rice.calories).toBe(163); // 325 * 125 / 250 = 162.5
      expect(rice.carbs).toBe(35);
      expect(rice.servingSize).toBe("1 cup (125 g)");
    });

    it("scales a cached result by its servingSize, not its source", async () => {
      mockLlmItems([{ name: "egg", quantity: 1, unit: "large", grams: 50 }]);
      mockLookup.mockResolvedValue({
        ...per100g(143, 12.6, 0.7, 9.5),
        source: "cache",
      });

      const [egg] = await parseNaturalLanguageFood("an egg");

      expect(egg.calories).toBe(72); // 71.5
    });

    it("marks the portion unknown, per 100 g, when grams are missing", async () => {
      mockLlmItems([{ name: "stew", quantity: 1, unit: "bowl" }]);
      mockLookup.mockResolvedValue(per100g(90, 5, 8, 4));

      const [stew] = await parseNaturalLanguageFood("a bowl of stew");

      expect(stew.calories).toBe(90);
      expect(stew.servingSize).toBe("100 g (portion unknown)");
    });

    it("normalizes a per-serving result to per 100 g when grams are missing", async () => {
      mockLlmItems([{ name: "rice", quantity: 1, unit: "cup" }]);
      mockLookup.mockResolvedValue(per100g(325, 6.5, 70, 0.8, "250g"));

      const [rice] = await parseNaturalLanguageFood("rice");

      expect(rice.calories).toBe(130);
      expect(rice.servingSize).toBe("100 g (portion unknown)");
    });

    it.each([
      ["negative", -50],
      ["zero", 0],
      ["absurdly large", 1_000_000],
      ["non-numeric", "lots"],
    ])(
      "treats %s grams as unknown instead of failing the parse",
      async (_label, grams) => {
        mockLlmItems([{ name: "egg", quantity: 2, unit: "large", grams }]);
        mockLookup.mockResolvedValue(per100g(143, 12.6, 0.7, 9.5));

        const [egg] = await parseNaturalLanguageFood("2 eggs");

        expect(egg.calories).toBe(143);
        expect(egg.servingSize).toBe("100 g (portion unknown)");
      },
    );

    it("keeps an unparseable basis as-is, labelled with that basis", async () => {
      mockLlmItems([{ name: "granola", quantity: 1, unit: "cup", grams: 60 }]);
      mockLookup.mockResolvedValue(per100g(250, 6, 40, 8, "1 serving"));

      const [granola] = await parseNaturalLanguageFood("a cup of granola");

      expect(granola.calories).toBe(250);
      expect(granola.servingSize).toBe("1 serving");
    });

    it("falls back to the plain name when lookupName is blank", async () => {
      mockLlmItems([
        {
          name: "toast",
          lookupName: "  ",
          quantity: 1,
          unit: "slice",
          grams: 30,
        },
      ]);
      mockLookup.mockResolvedValue(per100g(250, 10, 45, 3));

      await parseNaturalLanguageFood("toast");

      expect(mockLookup).toHaveBeenCalledWith("toast");
    });
  });

  // Fixture: LLM output recorded from the live parse prompt, nutrition values
  // are the real CNF per-100 g rows those lookup names resolve to. Asserts
  // each portion lands in a sane range — the regression was 470 kcal for
  // "2 eggs" and 305 kcal for one slice of toast.
  describe("sanity fixture", () => {
    const cases: {
      phrase: string;
      llm: LlmItem;
      per100: NutritionData;
      range: [number, number];
    }[] = [
      {
        phrase: "2 eggs and toast",
        llm: {
          name: "egg",
          lookupName: "egg, chicken, whole, cooked",
          quantity: 2,
          unit: "large",
          grams: 100,
        },
        per100: per100g(141, 11.8, 1.8, 10),
        range: [120, 180],
      },
      {
        phrase: "2 eggs and toast",
        llm: {
          name: "whole wheat toast",
          lookupName: "bread, whole wheat, toasted",
          quantity: 1,
          unit: "slice",
          grams: 30,
        },
        per100: per100g(305, 9.3, 56.3, 6),
        range: [60, 120],
      },
      {
        phrase: "a can of coke",
        llm: {
          name: "Coca-Cola",
          lookupName: "carbonated drinks, cola",
          quantity: 1,
          unit: "can",
          grams: 355,
        },
        per100: per100g(41, 0, 10.6, 0),
        range: [120, 170],
      },
      {
        phrase: "1 cup of rice",
        llm: {
          name: "rice",
          lookupName: "rice, white, long-grain, cooked",
          quantity: 1,
          unit: "cup",
          grams: 160,
        },
        per100: per100g(130, 2.7, 28.2, 0.3),
        range: [180, 260],
      },
    ];

    it.each(cases)(
      "$phrase → $llm.name lands in a sane calorie range",
      async ({ phrase, llm, per100, range }) => {
        mockLlmItems([llm]);
        mockLookup.mockResolvedValue(per100);

        const [item] = await parseNaturalLanguageFood(phrase);

        expect(item.calories).toBeGreaterThanOrEqual(range[0]);
        expect(item.calories).toBeLessThanOrEqual(range[1]);
      },
    );
  });
});
