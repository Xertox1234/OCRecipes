import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  analyzeIngredientPhoto,
  IngredientAnalysisError,
  calculateSessionNutrition,
  calculateSessionMacros,
} from "../cooking-session";
import type { CookingSessionIngredient } from "@shared/types/cook-session";

import { openai } from "../../lib/openai";
import { batchNutritionLookup } from "../nutrition-lookup";
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

  it("sums nutrition for multiple ingredients", async () => {
    vi.mocked(batchNutritionLookup).mockResolvedValue(
      new Map([
        [
          "200 g chicken breast",
          createMockNutritionData({
            calories: 330,
            protein: 62,
            carbs: 0,
            fat: 7.2,
            fiber: 0,
            sugar: 0,
            sodium: 120,
          }),
        ],
        [
          "150 g white rice",
          createMockNutritionData({
            calories: 195,
            protein: 3.6,
            carbs: 43.5,
            fat: 0.3,
            fiber: 0.6,
            sugar: 0,
            sodium: 1,
          }),
        ],
      ]),
    );

    const result = await calculateSessionNutrition([chicken, rice]);

    expect(result.items).toHaveLength(2);
    expect(result.total.calories).toBe(525); // 330 + 195
    expect(result.total.protein).toBe(65.6); // 62 + 3.6
    expect(result.total.carbs).toBe(43.5);
    expect(result.total.fat).toBe(7.5); // 7.2 + 0.3 rounded to 1dp
    expect(result.total.sodium).toBe(121); // 120 + 1
  });

  it("rounds totals correctly", async () => {
    vi.mocked(batchNutritionLookup).mockResolvedValue(
      new Map([
        [
          "200 g chicken breast",
          createMockNutritionData({
            calories: 330.7,
            protein: 62.15,
            carbs: 0.33,
            fat: 7.27,
            fiber: 0.04,
            sugar: 0.06,
            sodium: 120.4,
          }),
        ],
      ]),
    );

    const result = await calculateSessionNutrition([chicken]);

    expect(result.total.calories).toBe(331); // rounded to integer
    expect(result.total.protein).toBe(62.2); // rounded to 1dp
    expect(result.total.carbs).toBe(0.3);
    expect(result.total.fat).toBe(7.3);
    expect(result.total.fiber).toBe(0);
    expect(result.total.sugar).toBe(0.1);
    expect(result.total.sodium).toBe(120); // rounded to integer
  });

  it("applies cooking method adjustment from global parameter", async () => {
    vi.mocked(batchNutritionLookup).mockResolvedValue(
      new Map([
        [
          "200 g chicken breast",
          createMockNutritionData({
            calories: 330,
            protein: 62,
            carbs: 0,
            fat: 7.2,
            fiber: 0,
            sugar: 0,
            sodium: 120,
          }),
        ],
      ]),
    );
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

    expect(result.items[0].cookingMethodApplied).toBe("grilled");
    expect(result.items[0].calories).toBe(280);
    expect(result.total.calories).toBe(280);
  });

  it("skips cooking adjustment for 'raw' method", async () => {
    vi.mocked(batchNutritionLookup).mockResolvedValue(
      new Map([
        [
          "200 g chicken breast",
          createMockNutritionData({
            calories: 330,
            protein: 62,
            carbs: 0,
            fat: 7.2,
            fiber: 0,
            sugar: 0,
            sodium: 120,
          }),
        ],
      ]),
    );

    const result = await calculateSessionNutrition([chicken], "raw");

    expect(preparationToCookingMethod).not.toHaveBeenCalled();
    expect(result.items[0].cookingMethodApplied).toBeUndefined();
    expect(result.items[0].calories).toBe(330);
  });

  it("skips cooking adjustment for 'As Served' method", async () => {
    vi.mocked(batchNutritionLookup).mockResolvedValue(
      new Map([
        [
          "200 g chicken breast",
          createMockNutritionData({
            calories: 330,
            protein: 62,
            carbs: 0,
            fat: 7.2,
            fiber: 0,
            sugar: 0,
            sodium: 120,
          }),
        ],
      ]),
    );

    const result = await calculateSessionNutrition([chicken], "As Served");

    expect(preparationToCookingMethod).not.toHaveBeenCalled();
    expect(result.items[0].cookingMethodApplied).toBeUndefined();
  });

  it("uses per-ingredient preparationMethod over global method", async () => {
    const chickenWithPrep: CookingSessionIngredient = {
      ...chicken,
      preparationMethod: "fried",
    };

    vi.mocked(batchNutritionLookup).mockResolvedValue(
      new Map([
        [
          "200 g chicken breast",
          createMockNutritionData({
            calories: 330,
            protein: 62,
            carbs: 0,
            fat: 7.2,
            fiber: 0,
            sugar: 0,
            sodium: 120,
          }),
        ],
      ]),
    );
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
    vi.mocked(batchNutritionLookup).mockResolvedValue(
      new Map([
        [
          "200 g chicken breast",
          createMockNutritionData({
            calories: 330,
            protein: 62,
            carbs: 0,
            fat: 7.2,
            fiber: 0,
            sugar: 0,
            sodium: 120,
          }),
        ],
        // rice has no entry — simulates lookup failure
      ]),
    );

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

  it("sums macros from multiple ingredients", async () => {
    vi.mocked(batchNutritionLookup).mockResolvedValue(
      new Map([
        [
          "200 g chicken breast",
          createMockNutritionData({
            calories: 330,
            protein: 62,
            carbs: 0,
            fat: 7.2,
          }),
        ],
        [
          "150 g white rice",
          createMockNutritionData({
            calories: 195,
            protein: 3.6,
            carbs: 43.5,
            fat: 0.3,
          }),
        ],
      ]),
    );

    const result = await calculateSessionMacros([chicken, rice]);

    expect(result.calories).toBe(525);
    expect(result.protein).toBe(65.6);
    expect(result.carbs).toBe(43.5);
    expect(result.fat).toBe(7.5);
  });

  it("rounds totals consistently with calculateSessionNutrition", async () => {
    vi.mocked(batchNutritionLookup).mockResolvedValue(
      new Map([
        [
          "200 g chicken breast",
          createMockNutritionData({
            calories: 330.7,
            protein: 62.15,
            carbs: 0.33,
            fat: 7.27,
          }),
        ],
      ]),
    );

    const result = await calculateSessionMacros([chicken]);

    expect(result.calories).toBe(331); // integer
    expect(result.protein).toBe(62.2); // 1 decimal
    expect(result.carbs).toBe(0.3);
    expect(result.fat).toBe(7.3);
  });

  it("skips ingredients with no nutrition data", async () => {
    vi.mocked(batchNutritionLookup).mockResolvedValue(
      new Map([
        [
          "200 g chicken breast",
          createMockNutritionData({
            calories: 330,
            protein: 62,
            carbs: 0,
            fat: 7.2,
          }),
        ],
        // rice missing
      ]),
    );

    const result = await calculateSessionMacros([chicken, rice]);

    expect(result.calories).toBe(330);
    expect(result.protein).toBe(62);
  });
});
