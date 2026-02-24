import { z } from "zod";
import { storage } from "../storage";

const USDA_API_KEY = process.env.USDA_API_KEY || "DEMO_KEY";
const USDA_BASE_URL = "https://api.nal.usda.gov/fdc/v1";
const MICRONUTRIENT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Key micronutrients to track with their USDA nutrient IDs
const TRACKED_NUTRIENTS: Record<
  string,
  { id: number; unit: string; dailyValue: number }
> = {
  "Vitamin A": { id: 1106, unit: "mcg", dailyValue: 900 },
  "Vitamin C": { id: 1162, unit: "mg", dailyValue: 90 },
  "Vitamin D": { id: 1114, unit: "mcg", dailyValue: 20 },
  "Vitamin E": { id: 1109, unit: "mg", dailyValue: 15 },
  "Vitamin K": { id: 1185, unit: "mcg", dailyValue: 120 },
  "Vitamin B1 (Thiamin)": { id: 1165, unit: "mg", dailyValue: 1.2 },
  "Vitamin B2 (Riboflavin)": { id: 1166, unit: "mg", dailyValue: 1.3 },
  "Vitamin B3 (Niacin)": { id: 1167, unit: "mg", dailyValue: 16 },
  "Vitamin B6": { id: 1175, unit: "mg", dailyValue: 1.7 },
  "Vitamin B12": { id: 1178, unit: "mcg", dailyValue: 2.4 },
  Folate: { id: 1177, unit: "mcg", dailyValue: 400 },
  Calcium: { id: 1087, unit: "mg", dailyValue: 1300 },
  Iron: { id: 1089, unit: "mg", dailyValue: 18 },
  Magnesium: { id: 1090, unit: "mg", dailyValue: 420 },
  Phosphorus: { id: 1091, unit: "mg", dailyValue: 1250 },
  Potassium: { id: 1092, unit: "mg", dailyValue: 4700 },
  Zinc: { id: 1095, unit: "mg", dailyValue: 11 },
  Selenium: { id: 1103, unit: "mcg", dailyValue: 55 },
  Copper: { id: 1098, unit: "mg", dailyValue: 0.9 },
  Manganese: { id: 1101, unit: "mg", dailyValue: 2.3 },
};

export interface MicronutrientData {
  nutrientName: string;
  amount: number;
  unit: string;
  percentDailyValue: number;
}

const usdaSearchSchema = z.object({
  foods: z.array(
    z.object({
      fdcId: z.number(),
      description: z.string(),
      foodNutrients: z.array(
        z.object({
          nutrientId: z.number(),
          nutrientName: z.string(),
          value: z.number().optional().default(0),
          unitName: z.string().optional().default(""),
        }),
      ),
    }),
  ),
});

/**
 * Look up micronutrient data for a food item from USDA.
 */
async function lookupMicronutrients(
  foodName: string,
): Promise<MicronutrientData[]> {
  try {
    const url = `${USDA_BASE_URL}/foods/search?api_key=${USDA_API_KEY}&query=${encodeURIComponent(foodName)}&pageSize=1&dataType=Survey (FNDDS)`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) return [];

    const data = await response.json();
    const parsed = usdaSearchSchema.safeParse(data);
    if (!parsed.success || parsed.data.foods.length === 0) return [];

    const food = parsed.data.foods[0];
    const trackedIds = new Set(
      Object.values(TRACKED_NUTRIENTS).map((n) => n.id),
    );

    const micronutrients: MicronutrientData[] = [];

    for (const nutrient of food.foodNutrients) {
      if (!trackedIds.has(nutrient.nutrientId)) continue;

      const entry = Object.entries(TRACKED_NUTRIENTS).find(
        ([, v]) => v.id === nutrient.nutrientId,
      );
      if (!entry || !nutrient.value) continue;

      const [name, config] = entry;
      const amount = Math.round(nutrient.value * 100) / 100;
      const percentDV =
        config.dailyValue > 0
          ? Math.round((amount / config.dailyValue) * 100)
          : 0;

      micronutrients.push({
        nutrientName: name,
        amount,
        unit: config.unit,
        percentDailyValue: percentDV,
      });
    }

    // Sort by percent daily value descending
    micronutrients.sort((a, b) => b.percentDailyValue - a.percentDailyValue);

    return micronutrients;
  } catch (error) {
    console.error("Micronutrient lookup error:", error);
    return [];
  }
}

/**
 * Get the daily value reference for all tracked nutrients.
 */
export function getDailyValueReference(): Record<
  string,
  { unit: string; dailyValue: number }
> {
  const ref: Record<string, { unit: string; dailyValue: number }> = {};
  for (const [name, config] of Object.entries(TRACKED_NUTRIENTS)) {
    ref[name] = { unit: config.unit, dailyValue: config.dailyValue };
  }
  return ref;
}

/**
 * Aggregate micronutrient data from multiple food items for daily summary.
 */
export function aggregateMicronutrients(
  items: MicronutrientData[][],
): MicronutrientData[] {
  const totals = new Map<string, { amount: number; unit: string }>();

  for (const itemNutrients of items) {
    for (const nutrient of itemNutrients) {
      const existing = totals.get(nutrient.nutrientName);
      if (existing) {
        existing.amount += nutrient.amount;
      } else {
        totals.set(nutrient.nutrientName, {
          amount: nutrient.amount,
          unit: nutrient.unit,
        });
      }
    }
  }

  const result: MicronutrientData[] = [];
  for (const [name, data] of totals.entries()) {
    const config = TRACKED_NUTRIENTS[name];
    const percentDV =
      config && config.dailyValue > 0
        ? Math.round((data.amount / config.dailyValue) * 100)
        : 0;

    result.push({
      nutrientName: name,
      amount: Math.round(data.amount * 100) / 100,
      unit: data.unit,
      percentDailyValue: percentDV,
    });
  }

  result.sort((a, b) => b.percentDailyValue - a.percentDailyValue);
  return result;
}

function cacheKey(foodName: string): string {
  return foodName.trim().toLowerCase();
}

/**
 * Look up micronutrients with database caching. Only calls USDA on cache miss.
 */
export async function lookupMicronutrientsWithCache(
  foodName: string,
): Promise<MicronutrientData[]> {
  const key = cacheKey(foodName);
  const cached = await storage.getMicronutrientCache(key);
  if (cached) return cached as MicronutrientData[];

  const result = await lookupMicronutrients(foodName);
  if (result.length > 0) {
    storage
      .setMicronutrientCache(key, result, MICRONUTRIENT_CACHE_TTL_MS)
      .catch(console.error);
  }
  return result;
}

/**
 * Batch lookup micronutrients for multiple food names in parallel with caching.
 */
export async function batchLookupMicronutrients(
  foodNames: string[],
): Promise<MicronutrientData[][]> {
  return Promise.all(foodNames.map(lookupMicronutrientsWithCache));
}

export { TRACKED_NUTRIENTS };
