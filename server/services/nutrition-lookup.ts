import pLimit from "p-limit";
import { z } from "zod";
import { db } from "../db";
import { nutritionCache } from "@shared/schema";
import { and, gt, inArray } from "drizzle-orm";

// Rate limiting for parallel requests
const RATE_LIMIT = 5;
const limit = pLimit(RATE_LIMIT);

// Cache expiry: 7 days
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// Zod schema for CalorieNinjas API response validation
const calorieNinjasItemSchema = z.object({
  name: z.string(),
  calories: z.number(),
  protein_g: z.number(),
  carbohydrates_total_g: z.number(),
  fat_total_g: z.number(),
  fiber_g: z.number().optional().default(0),
  sugar_g: z.number().optional().default(0),
  sodium_mg: z.number().optional().default(0),
  serving_size_g: z.number().optional().default(100),
});

const calorieNinjasResponseSchema = z.object({
  items: z.array(calorieNinjasItemSchema),
});

// Zod schema for USDA API response
const usdaFoodSchema = z.object({
  description: z.string(),
  foodNutrients: z.array(
    z.object({
      nutrientName: z.string(),
      value: z.number().optional().default(0),
    }),
  ),
});

const usdaResponseSchema = z.object({
  foods: z.array(usdaFoodSchema),
});

export interface NutritionData {
  name: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
  sugar: number;
  sodium: number;
  servingSize: string;
  source: "calorieninjas" | "usda" | "cache";
}

/**
 * Normalize food name for cache key
 */
function normalizeForCache(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Get cached nutrition data
 */
async function getCachedNutrition(
  items: string[],
): Promise<Map<string, NutritionData>> {
  const results = new Map<string, NutritionData>();

  if (items.length === 0) return results;

  const normalizedKeys = items.map(normalizeForCache);
  const now = new Date();

  try {
    // Query only matching cache entries using inArray for efficiency
    const cached = await db
      .select()
      .from(nutritionCache)
      .where(
        and(
          inArray(nutritionCache.queryKey, normalizedKeys),
          gt(nutritionCache.expiresAt, now),
        ),
      );

    for (const entry of cached) {
      const index = normalizedKeys.indexOf(entry.queryKey);
      if (index !== -1) {
        const data = entry.data as NutritionData;
        results.set(items[index], { ...data, source: "cache" });
      }
    }
  } catch (error) {
    console.error("Cache lookup error:", error);
  }

  return results;
}

/**
 * Cache nutrition data
 */
async function cacheNutrition(
  query: string,
  data: NutritionData,
): Promise<void> {
  const key = normalizeForCache(query);
  const expiresAt = new Date(Date.now() + CACHE_EXPIRY_MS);

  try {
    await db
      .insert(nutritionCache)
      .values({
        queryKey: key,
        normalizedName: data.name,
        source: data.source === "cache" ? "calorieninjas" : data.source,
        data: data,
        expiresAt,
      })
      .onConflictDoUpdate({
        target: nutritionCache.queryKey,
        set: {
          data: data,
          expiresAt,
        },
      });
  } catch (error) {
    console.error("Cache write error:", error);
  }
}

/**
 * Lookup nutrition data from CalorieNinjas API
 */
async function lookupCalorieNinjas(
  query: string,
): Promise<NutritionData | null> {
  const apiKey = process.env.CALORIENINJAS_API_KEY;
  if (!apiKey) {
    console.error("CALORIENINJAS_API_KEY not configured");
    return null;
  }

  try {
    const response = await fetch(
      `https://api.calorieninjas.com/v1/nutrition?query=${encodeURIComponent(query)}`,
      {
        headers: { "X-Api-Key": apiKey },
      },
    );

    if (!response.ok) {
      console.error(`CalorieNinjas API error: ${response.status}`);
      return null;
    }

    const json = await response.json();
    const parsed = calorieNinjasResponseSchema.safeParse(json);

    if (!parsed.success || parsed.data.items.length === 0) {
      return null;
    }

    const item = parsed.data.items[0];
    return {
      name: item.name,
      calories: item.calories,
      protein: item.protein_g,
      carbs: item.carbohydrates_total_g,
      fat: item.fat_total_g,
      fiber: item.fiber_g,
      sugar: item.sugar_g,
      sodium: item.sodium_mg,
      servingSize: `${item.serving_size_g}g`,
      source: "calorieninjas",
    };
  } catch (error) {
    console.error("CalorieNinjas lookup error:", error);
    return null;
  }
}

// Warn at startup if using USDA DEMO_KEY (severe rate limits: 40 req/hour)
const USDA_API_KEY = process.env.USDA_API_KEY || "DEMO_KEY";
if (USDA_API_KEY === "DEMO_KEY") {
  console.warn(
    "⚠️  USDA_API_KEY not set - using DEMO_KEY with 40 requests/hour limit",
  );
}

/**
 * Lookup nutrition data from USDA FoodData Central (fallback)
 */
async function lookupUSDA(query: string): Promise<NutritionData | null> {
  try {
    const response = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&pageSize=1&api_key=${USDA_API_KEY}`,
    );

    if (!response.ok) {
      return null;
    }

    const json = await response.json();
    const parsed = usdaResponseSchema.safeParse(json);

    if (!parsed.success || parsed.data.foods.length === 0) {
      return null;
    }

    const food = parsed.data.foods[0];
    const nutrients = food.foodNutrients;

    // Extract nutrients by name
    const findNutrient = (names: string[]): number => {
      for (const name of names) {
        const nutrient = nutrients.find((n) =>
          n.nutrientName.toLowerCase().includes(name.toLowerCase()),
        );
        if (nutrient) return nutrient.value || 0;
      }
      return 0;
    };

    return {
      name: food.description,
      calories: findNutrient(["Energy"]),
      protein: findNutrient(["Protein"]),
      carbs: findNutrient(["Carbohydrate"]),
      fat: findNutrient(["Total lipid", "Fat"]),
      fiber: findNutrient(["Fiber"]),
      sugar: findNutrient(["Sugars"]),
      sodium: findNutrient(["Sodium"]),
      servingSize: "100g",
      source: "usda",
    };
  } catch (error) {
    console.error("USDA lookup error:", error);
    return null;
  }
}

/**
 * Lookup nutrition data for a single item
 */
export async function lookupNutrition(
  query: string,
): Promise<NutritionData | null> {
  // Check cache first
  const cached = await getCachedNutrition([query]);
  const cachedResult = cached.get(query);
  if (cachedResult) return cachedResult;

  // Try CalorieNinjas first
  const calorieNinjasResult = await lookupCalorieNinjas(query);
  if (calorieNinjasResult) {
    await cacheNutrition(query, calorieNinjasResult);
    return calorieNinjasResult;
  }

  // Fallback to USDA
  const usdaResult = await lookupUSDA(query);
  if (usdaResult) {
    await cacheNutrition(query, usdaResult);
  }
  return usdaResult;
}

/**
 * Batch lookup nutrition data for multiple items with caching and parallel requests
 */
export async function batchNutritionLookup(
  items: string[],
): Promise<Map<string, NutritionData | null>> {
  const results = new Map<string, NutritionData | null>();

  if (items.length === 0) return results;

  // Check cache first
  const cached = await getCachedNutrition(items);
  for (const [item, data] of cached) {
    results.set(item, data);
  }

  // Find uncached items
  const uncached = items.filter((item) => !results.has(item));

  if (uncached.length === 0) {
    return results;
  }

  // Parallel lookup with rate limiting
  const lookupPromises = uncached.map((item) =>
    limit(async () => {
      const data = await lookupNutrition(item);
      if (data) {
        await cacheNutrition(item, data);
      }
      return { item, data };
    }),
  );

  const freshResults = await Promise.all(lookupPromises);
  for (const { item, data } of freshResults) {
    results.set(item, data);
  }

  return results;
}
