import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  analyzeIngredientPhoto,
  IngredientAnalysisError,
  calculateSessionNutrition,
  calculateSessionMacros,
} from "../cooking-session";
import type { CookingSessionIngredient } from "@shared/types/cook-session";

import { openai } from "../../lib/openai";
import { batchNutritionLookup, type NutritionData } from "../nutrition-lookup";
import {
  calculateCookedNutrition,
  preparationToCookingMethod,
} from "../cooking-adjustment";
import {
  createMockNutritionData,
  createMockCookedNutrition,
  createMockChatCompletion,
} from "../../__tests__/factories";

// ── Mocks ────────────────────────────────────────────────────────────────

vi.mock("../../lib/openai", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
  OPENAI_TIMEOUT_HEAVY_MS: 30000,
  MODEL_FAST: "gpt-4o-mini",
  MODEL_HEAVY: "gpt-4o",
}));

vi.mock("../../lib/ai-safety", () => ({
  SYSTEM_PROMPT_BOUNDARY: "--- SYSTEM BOUNDARY ---",
}));

vi.mock("../nutrition-lookup", () => ({
  batchNutritionLookup: vi.fn(),
}));

vi.mock("../cooking-adjustment", () => ({
  calculateCookedNutrition: vi.fn(),
  preparationToCookingMethod: vi.fn(),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────

const chicken: CookingSessionIngredient = {
  id: "ing-1",
  name: "chicken breast",
  quantity: 200,
  unit: "g",
  confidence: 0.9,
  category: "protein",
  photoId: "photo-1",
  userEdited: false,
};

const rice: CookingSessionIngredient = {
  id: "ing-2",
  name: "white rice",
  quantity: 150,
  unit: "g",
  confidence: 0.85,
  category: "grain",
  photoId: "photo-1",
  userEdited: false,
};

function ingredient(
  overrides: Partial<CookingSessionIngredient>,
): CookingSessionIngredient {
  return { ...chicken, id: "ing-x", category: "other", ...overrides };
}

/** A lookup result on a per-100 g basis, as CNF and USDA answer. */
function per100g(overrides: Partial<NutritionData> = {}): NutritionData {
  return createMockNutritionData({ servingSize: "100g", ...overrides });
}

function mockLookups(table: Record<string, NutritionData>) {
  vi.mocked(batchNutritionLookup).mockResolvedValue(
    new Map(Object.entries(table)),
  );
}

const chickenValues = {
  calories: 165,
  protein: 31,
  carbs: 0,
  fat: 3.6,
  fiber: 0,
  sugar: 0,
  sodium: 60,
};
const chickenPer100g = per100g(chickenValues);
const ricePer100g = per100g({
  calories: 130,
  protein: 2.4,
  carbs: 29,
  fat: 0.2,
  fiber: 0.4,
  sugar: 1,
  sodium: 0.7,
});

beforeEach(() => {
  vi.clearAllMocks();
});

// ════════════════════════════════════════════════════════════════════════
// analyzeIngredientPhoto
// ════════════════════════════════════════════════════════════════════════

describe("analyzeIngredientPhoto", () => {
  it("returns parsed ingredients from a valid OpenAI response", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue(
      createMockChatCompletion(
        JSON.stringify({
          ingredients: [
            {
              name: "chicken breast",
              quantity: 200,
              unit: "g",
              confidence: 0.9,
              category: "protein",
            },
            {
              name: "broccoli",
              quantity: 100,
              unit: "g",
              confidence: 0.8,
              category: "vegetable",
            },
          ],
        }),
      ),
    );

    const result = await analyzeIngredientPhoto("base64data", "image/jpeg", 0);

    expect(result).toHaveLength(2);
    expect(result[0].name).toBe("chicken breast");
    expect(result[0].quantity).toBe(200);
    expect(result[0].category).toBe("protein");
    expect(result[0].photoId).toBe("");
    expect(result[0].userEdited).toBe(false);
    expect(result[0].id).toBeDefined();
    expect(result[1].name).toBe("broccoli");
  });

  it("uses low detail for photos when count >= 4", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue(
      createMockChatCompletion(JSON.stringify({ ingredients: [] })),
    );

    await analyzeIngredientPhoto("base64data", "image/jpeg", 4);

    const callArgs = vi.mocked(openai.chat.completions.create).mock.calls[0];
    const messages = (callArgs[0] as { messages: unknown[] }).messages;
    const userMessage = messages[1] as {
      content: { image_url: { detail: string } }[];
    };
    expect(userMessage.content[0].image_url.detail).toBe("low");
  });

  it("uses high detail for photos when count < 4", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue(
      createMockChatCompletion(JSON.stringify({ ingredients: [] })),
    );

    await analyzeIngredientPhoto("base64data", "image/jpeg", 3);

    const callArgs = vi.mocked(openai.chat.completions.create).mock.calls[0];
    const messages = (callArgs[0] as { messages: unknown[] }).messages;
    const userMessage = messages[1] as {
      content: { image_url: { detail: string } }[];
    };
    expect(userMessage.content[0].image_url.detail).toBe("high");
  });

  it("throws IngredientAnalysisError when OpenAI returns no content", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue(
      createMockChatCompletion(null),
    );

    await expect(
      analyzeIngredientPhoto("base64data", "image/jpeg", 0),
    ).rejects.toThrow(IngredientAnalysisError);
    await expect(
      analyzeIngredientPhoto("base64data", "image/jpeg", 0),
    ).rejects.toThrow("No response from ingredient analysis");
  });

  it("throws IngredientAnalysisError when OpenAI returns invalid JSON", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue(
      createMockChatCompletion("not json {{{"),
    );

    await expect(
      analyzeIngredientPhoto("base64data", "image/jpeg", 0),
    ).rejects.toThrow(IngredientAnalysisError);
    await expect(
      analyzeIngredientPhoto("base64data", "image/jpeg", 0),
    ).rejects.toThrow("Invalid JSON from ingredient analysis");
  });

  it("throws IngredientAnalysisError when response fails Zod validation", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue(
      createMockChatCompletion(JSON.stringify({ wrong_key: "bad schema" })),
    );

    await expect(
      analyzeIngredientPhoto("base64data", "image/jpeg", 0),
    ).rejects.toThrow(IngredientAnalysisError);
    await expect(
      analyzeIngredientPhoto("base64data", "image/jpeg", 0),
    ).rejects.toThrow("Unexpected response format");
  });

  it("assigns unique IDs to each detected ingredient", async () => {
    vi.mocked(openai.chat.completions.create).mockResolvedValue(
      createMockChatCompletion(
        JSON.stringify({
          ingredients: [
            {
              name: "a",
              quantity: 1,
              unit: "g",
              confidence: 0.9,
              category: "other",
            },
            {
              name: "b",
              quantity: 2,
              unit: "g",
              confidence: 0.9,
              category: "other",
            },
          ],
        }),
      ),
    );

    const result = await analyzeIngredientPhoto("base64data", "image/jpeg", 0);
    expect(result[0].id).not.toBe(result[1].id);
  });
});

// ════════════════════════════════════════════════════════════════════════
// calculateSessionNutrition
// ════════════════════════════════════════════════════════════════════════

describe("calculateSessionNutrition", () => {
  it("returns zeroed items when no nutrition data is found", async () => {
    vi.mocked(batchNutritionLookup).mockResolvedValue(new Map());

    const result = await calculateSessionNutrition([chicken]);

    expect(result.total.calories).toBe(0);
    expect(result.total.protein).toBe(0);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].calories).toBe(0);
    expect(result.items[0].servingSize).toBe("200 g");
  });

  it("looks up each ingredient by name, without its quantity", async () => {
    vi.mocked(batchNutritionLookup).mockResolvedValue(new Map());

    await calculateSessionNutrition([chicken, rice]);

    expect(batchNutritionLookup).toHaveBeenCalledWith([
      "chicken breast",
      "white rice",
    ]);
  });

  it("scales each ingredient's per-100 g values to its weight and sums them", async () => {
    mockLookups({
      "chicken breast": chickenPer100g,
      "white rice": ricePer100g,
    });

    const result = await calculateSessionNutrition([chicken, rice]);

    expect(result.items[0]).toMatchObject({
      calories: 330,
      protein: 62,
      fat: 7.2,
      sodium: 120,
      servingSize: "200 g",
    });
    expect(result.items[1]).toMatchObject({
      calories: 195,
      carbs: 43.5,
      fiber: 0.6,
      sugar: 1.5,
      servingSize: "150 g",
    });
    expect(result.total).toEqual({
      calories: 525, // 330 + 195
      protein: 65.6, // 62 + 3.6
      carbs: 43.5,
      fat: 7.5, // 7.2 + 0.3
      fiber: 0.6,
      sugar: 1.5,
      sodium: 121, // 120 + 1.05
    });
  });

  it.each([
    [1, "cup", 240],
    [2, "cups", 480],
    [2, "tbsp", 30],
    [1, "tablespoon", 15],
    [3, "tsp", 15],
    [8, "oz", 227],
    [1, "lb", 454],
    [0.5, "kg", 500],
    [250, "ml", 250],
    [1, "l", 1000],
    [1, "litre", 1000],
    [120, "grams", 120],
  ])("converts %s %s to grams", async (quantity, unit, grams) => {
    mockLookups({ flour: per100g({ calories: 100 }) });

    const result = await calculateSessionNutrition([
      ingredient({ name: "flour", quantity, unit }),
    ]);

    // 100 kcal per 100 g, so calories equal the weight in grams
    expect(result.items[0].calories).toBe(grams);
    expect(result.items[0].servingSize).toBe(`${quantity} ${unit}`);
  });

  it("does not scale a per-serving result twice", async () => {
    // API Ninjas answers per serving: 120 kcal in 240 g
    mockLookups({
      milk: per100g({ calories: 120, servingSize: "240g" }),
    });

    const result = await calculateSessionNutrition([
      ingredient({ name: "milk", quantity: 1, unit: "cup" }),
    ]);

    expect(result.items[0].calories).toBe(120);
  });

  it("marks an ingredient whose unit has no weight, keeping it per 100 g", async () => {
    mockLookups({ egg: per100g({ calories: 143, protein: 12.6 }) });

    const result = await calculateSessionNutrition([
      ingredient({ name: "egg", quantity: 3, unit: "piece" }),
    ]);

    expect(result.items[0]).toMatchObject({
      calories: 143,
      protein: 12.6,
      servingSize: "100 g (portion unknown)",
    });
    expect(result.total.calories).toBe(143);
  });

  it("keeps a result it cannot weigh with the source's own serving size", async () => {
    mockLookups({
      "granola bar": per100g({ calories: 190, servingSize: "1 serving" }),
    });

    const result = await calculateSessionNutrition([
      ingredient({ name: "granola bar", quantity: 2, unit: "piece" }),
    ]);

    expect(result.items[0]).toMatchObject({
      calories: 190,
      servingSize: "1 serving",
    });
  });

  it("rounds totals correctly", async () => {
    mockLookups({
      "chicken breast": per100g({
        calories: 330.7,
        protein: 62.15,
        carbs: 0.33,
        fat: 7.27,
        fiber: 0.04,
        sugar: 0.06,
        sodium: 120.4,
      }),
    });

    const result = await calculateSessionNutrition([
      ingredient({ ...chicken, quantity: 100 }),
    ]);

    expect(result.total.calories).toBe(331); // rounded to integer
    expect(result.total.protein).toBe(62.2); // rounded to 1dp
    expect(result.total.carbs).toBe(0.3);
    expect(result.total.fat).toBe(7.3);
    expect(result.total.fiber).toBe(0);
    expect(result.total.sugar).toBe(0.1);
    expect(result.total.sodium).toBe(120); // rounded to integer
  });

  it("applies cooking method adjustment from global parameter", async () => {
    mockLookups({ "chicken breast": chickenPer100g });
    vi.mocked(preparationToCookingMethod).mockReturnValue("grilled");
    vi.mocked(calculateCookedNutrition).mockReturnValue(
      createMockCookedNutrition({
        calories: 280,
        protein: 58,
        carbs: 0,
        fat: 6,
        fiber: 0,
        sugar: 0,
        sodium: 100,
        adjustmentApplied: true,
      }),
    );

    const result = await calculateSessionNutrition([chicken], "grilled");

    expect(calculateCookedNutrition).toHaveBeenCalledWith(
      chickenValues,
      200,
      "protein",
      "grilled",
    );
    expect(result.items[0].cookingMethodApplied).toBe("grilled");
    expect(result.items[0].calories).toBe(280);
    expect(result.total.calories).toBe(280);
  });

  it("gives the cooking adjustment per-100 g values and the weight in grams", async () => {
    // A per-serving basis (50 kcal in 50 g) and a volume unit
    mockLookups({
      rice: per100g({
        calories: 50,
        protein: 1,
        carbs: 10,
        fat: 0.5,
        fiber: 0.2,
        sugar: 0,
        sodium: 2,
        servingSize: "50g",
      }),
    });
    vi.mocked(preparationToCookingMethod).mockReturnValue("boiled");
    vi.mocked(calculateCookedNutrition).mockReturnValue(
      createMockCookedNutrition({ adjustmentApplied: true }),
    );

    await calculateSessionNutrition(
      [
        ingredient({
          name: "rice",
          quantity: 2,
          unit: "cup",
          category: "grain",
        }),
      ],
      "boiled",
    );

    expect(calculateCookedNutrition).toHaveBeenCalledWith(
      {
        calories: 100,
        protein: 2,
        carbs: 20,
        fat: 1,
        fiber: 0.4,
        sugar: 0,
        sodium: 4,
      },
      480,
      "grain",
      "boiled",
    );
  });

  it("cooks an ingredient of unknown weight as 100 g", async () => {
    mockLookups({ egg: per100g({ calories: 143 }) });
    vi.mocked(preparationToCookingMethod).mockReturnValue("fried");
    vi.mocked(calculateCookedNutrition).mockReturnValue(
      createMockCookedNutrition({ calories: 196, adjustmentApplied: true }),
    );

    const result = await calculateSessionNutrition(
      [ingredient({ name: "egg", quantity: 3, unit: "piece" })],
      "fried",
    );

    expect(vi.mocked(calculateCookedNutrition).mock.calls[0][1]).toBe(100);
    expect(result.items[0]).toMatchObject({
      calories: 196,
      servingSize: "100 g (portion unknown)",
    });
  });

  it("skips the cooking adjustment for a result it cannot weigh", async () => {
    mockLookups({
      "granola bar": per100g({ calories: 190, servingSize: "1 serving" }),
    });
    vi.mocked(preparationToCookingMethod).mockReturnValue("baked");

    const result = await calculateSessionNutrition(
      [ingredient({ name: "granola bar", quantity: 1, unit: "piece" })],
      "baked",
    );

    expect(calculateCookedNutrition).not.toHaveBeenCalled();
    expect(result.items[0].cookingMethodApplied).toBeUndefined();
    expect(result.items[0].calories).toBe(190);
  });

  it("skips cooking adjustment for 'raw' method", async () => {
    mockLookups({ "chicken breast": chickenPer100g });

    const result = await calculateSessionNutrition([chicken], "raw");

    expect(preparationToCookingMethod).not.toHaveBeenCalled();
    expect(result.items[0].cookingMethodApplied).toBeUndefined();
    expect(result.items[0].calories).toBe(330);
  });

  it("skips cooking adjustment for 'As Served' method", async () => {
    mockLookups({ "chicken breast": chickenPer100g });

    const result = await calculateSessionNutrition([chicken], "As Served");

    expect(preparationToCookingMethod).not.toHaveBeenCalled();
    expect(result.items[0].cookingMethodApplied).toBeUndefined();
  });

  it("uses per-ingredient preparationMethod over global method", async () => {
    const chickenWithPrep: CookingSessionIngredient = {
      ...chicken,
      preparationMethod: "fried",
    };

    mockLookups({ "chicken breast": chickenPer100g });
    vi.mocked(preparationToCookingMethod).mockReturnValue("deep-fried");
    vi.mocked(calculateCookedNutrition).mockReturnValue(
      createMockCookedNutrition({
        calories: 400,
        protein: 55,
        carbs: 5,
        fat: 20,
        fiber: 0,
        sugar: 0,
        sodium: 150,
        adjustmentApplied: true,
      }),
    );

    const result = await calculateSessionNutrition(
      [chickenWithPrep],
      "grilled",
    );

    // Should have called with the per-ingredient method, not the global one
    expect(preparationToCookingMethod).toHaveBeenCalledWith("fried");
    expect(result.items[0].cookingMethodApplied).toBe("deep-fried");
  });

  it("handles mixed found and missing nutrition data", async () => {
    // rice has no entry — simulates lookup failure
    mockLookups({ "chicken breast": chickenPer100g });

    const result = await calculateSessionNutrition([chicken, rice]);

    expect(result.items).toHaveLength(2);
    expect(result.items[0].calories).toBe(330);
    expect(result.items[1].calories).toBe(0);
    expect(result.items[1].servingSize).toBe("150 g");
    expect(result.total.calories).toBe(330);
  });
});

// ════════════════════════════════════════════════════════════════════════
// calculateSessionMacros
// ════════════════════════════════════════════════════════════════════════

describe("calculateSessionMacros", () => {
  it("returns zeroed totals for empty ingredients array", async () => {
    vi.mocked(batchNutritionLookup).mockResolvedValue(new Map());

    const result = await calculateSessionMacros([]);

    expect(result).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });

  it("looks up each ingredient by name, without its quantity", async () => {
    vi.mocked(batchNutritionLookup).mockResolvedValue(new Map());

    await calculateSessionMacros([chicken, rice]);

    expect(batchNutritionLookup).toHaveBeenCalledWith([
      "chicken breast",
      "white rice",
    ]);
  });

  it("sums macros scaled to each ingredient's weight", async () => {
    mockLookups({
      "chicken breast": chickenPer100g,
      "white rice": ricePer100g,
    });

    const result = await calculateSessionMacros([chicken, rice]);

    expect(result).toEqual({
      calories: 525,
      protein: 65.6,
      carbs: 43.5,
      fat: 7.5,
    });
  });

  it("logs the same totals the summary shows", async () => {
    // One of each shape: weighed, per-serving basis, unknown unit, unweighable basis
    mockLookups({
      "chicken breast": chickenPer100g,
      milk: per100g({ calories: 120, protein: 8, servingSize: "240g" }),
      egg: per100g({ calories: 143, protein: 12.6 }),
      "granola bar": per100g({ calories: 190, servingSize: "1 serving" }),
    });
    const ingredients = [
      chicken,
      ingredient({ name: "milk", quantity: 2, unit: "cup" }),
      ingredient({ name: "egg", quantity: 3, unit: "piece" }),
      ingredient({ name: "granola bar", quantity: 1, unit: "piece" }),
    ];

    const macros = await calculateSessionMacros(ingredients);
    const { total } = await calculateSessionNutrition(ingredients);

    expect(macros).toEqual({
      calories: total.calories,
      protein: total.protein,
      carbs: total.carbs,
      fat: total.fat,
    });
    expect(macros.calories).toBe(330 + 240 + 143 + 190);
  });

  it("rounds totals consistently with calculateSessionNutrition", async () => {
    mockLookups({
      "chicken breast": per100g({
        calories: 330.7,
        protein: 62.15,
        carbs: 0.33,
        fat: 7.27,
      }),
    });

    const result = await calculateSessionMacros([
      ingredient({ ...chicken, quantity: 100 }),
    ]);

    expect(result.calories).toBe(331); // integer
    expect(result.protein).toBe(62.2); // 1 decimal
    expect(result.carbs).toBe(0.3);
    expect(result.fat).toBe(7.3);
  });

  it("skips ingredients with no nutrition data", async () => {
    // rice missing
    mockLookups({ "chicken breast": chickenPer100g });

    const result = await calculateSessionMacros([chicken, rice]);

    expect(result.calories).toBe(330);
    expect(result.protein).toBe(62);
  });
});
