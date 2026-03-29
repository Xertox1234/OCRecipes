import type {
  ScannedItem,
  DailyLog,
  NutritionCache,
  MicronutrientCache,
  FavouriteScannedItem,
} from "@shared/schema";
import type { NutritionData } from "../../services/nutrition-lookup";
import type { CookedNutrition } from "../../services/cooking-adjustment";

const scannedItemDefaults: ScannedItem = {
  id: 1,
  userId: "1",
  barcode: null,
  productName: "Test Product",
  brandName: null,
  servingSize: null,
  calories: "200",
  protein: "10",
  carbs: "25",
  fat: "8",
  fiber: null,
  sugar: null,
  sodium: null,
  imageUrl: null,
  sourceType: "barcode",
  photoUrl: null,
  aiConfidence: null,
  preparationMethods: null,
  analysisIntent: null,
  scannedAt: new Date("2024-01-01"),
  discardedAt: null,
};

export function createMockScannedItem(
  overrides: Partial<ScannedItem> = {},
): ScannedItem {
  return { ...scannedItemDefaults, ...overrides };
}

const dailyLogDefaults: DailyLog = {
  id: 1,
  userId: "1",
  scannedItemId: 1,
  recipeId: null,
  mealPlanItemId: null,
  source: "scan",
  servings: "1",
  mealType: null,
  loggedAt: new Date("2024-01-01"),
};

export function createMockDailyLog(
  overrides: Partial<DailyLog> = {},
): DailyLog {
  return { ...dailyLogDefaults, ...overrides };
}

const nutritionCacheDefaults: NutritionCache = {
  id: 1,
  queryKey: "test-key",
  normalizedName: "test product",
  source: "usda",
  data: {},
  hitCount: 0,
  createdAt: new Date("2024-01-01"),
  expiresAt: new Date("2025-01-01"),
};

export function createMockNutritionCache(
  overrides: Partial<NutritionCache> = {},
): NutritionCache {
  return { ...nutritionCacheDefaults, ...overrides };
}

const micronutrientCacheDefaults: MicronutrientCache = {
  id: 1,
  queryKey: "test-key",
  data: {},
  hitCount: 0,
  createdAt: new Date("2024-01-01"),
  expiresAt: new Date("2025-01-01"),
};

export function createMockMicronutrientCache(
  overrides: Partial<MicronutrientCache> = {},
): MicronutrientCache {
  return { ...micronutrientCacheDefaults, ...overrides };
}

const favouriteScannedItemDefaults: FavouriteScannedItem = {
  id: 1,
  userId: "1",
  scannedItemId: 1,
  createdAt: new Date("2024-01-01"),
};

export function createMockFavouriteScannedItem(
  overrides: Partial<FavouriteScannedItem> = {},
): FavouriteScannedItem {
  return { ...favouriteScannedItemDefaults, ...overrides };
}

const nutritionDataDefaults: NutritionData = {
  name: "test food",
  calories: 100,
  protein: 10,
  carbs: 20,
  fat: 5,
  fiber: 2,
  sugar: 3,
  sodium: 50,
  servingSize: "100 g",
  source: "usda",
};

export function createMockNutritionData(
  overrides: Partial<NutritionData> = {},
): NutritionData {
  return { ...nutritionDataDefaults, ...overrides };
}

const cookedNutritionDefaults: CookedNutrition = {
  calories: 100,
  protein: 10,
  carbs: 20,
  fat: 5,
  fiber: 2,
  sugar: 3,
  sodium: 50,
  cookedWeightG: 85,
  cookingMethod: "grilled",
  adjustmentApplied: true,
};

export function createMockCookedNutrition(
  overrides: Partial<CookedNutrition> = {},
): CookedNutrition {
  return { ...cookedNutritionDefaults, ...overrides };
}

/**
 * Create a minimal OpenAI ChatCompletion-shaped response for mocking.
 * Only includes the fields accessed by consuming code (choices[0].message.content).
 */
export function createMockChatCompletion(content: string | null) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion" as const,
    created: Date.now(),
    model: "gpt-4o",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant" as const,
          content,
          refusal: null,
        },
        finish_reason: "stop" as const,
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}
