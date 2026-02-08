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

// Zod schema for API Ninjas nutrition response validation.
// Free tier returns some fields as "Only available for premium subscribers."
// so we coerce strings to 0 for those fields.
const coerceNumber = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? v : 0));

const apiNinjasItemSchema = z.object({
  name: z.string(),
  calories: coerceNumber,
  protein_g: coerceNumber,
  carbohydrates_total_g: coerceNumber,
  fat_total_g: coerceNumber,
  fiber_g: coerceNumber.optional().default(0),
  sugar_g: coerceNumber.optional().default(0),
  sodium_mg: coerceNumber.optional().default(0),
  serving_size_g: coerceNumber.optional().default(100),
});

// API Ninjas returns a raw array, not { items: [...] }
const apiNinjasResponseSchema = z.array(apiNinjasItemSchema);

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
  source: "api-ninjas" | "usda" | "cnf" | "cache";
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
        source: data.source === "cache" ? "usda" : data.source,
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
 * Lookup nutrition data from API Ninjas (last-resort fallback).
 * Note: free tier does NOT include calories or protein — those fields
 * will be 0. Only useful as a fallback for carbs/fat/fiber/sugar/sodium.
 */
async function lookupAPINinjas(query: string): Promise<NutritionData | null> {
  const apiKey = process.env.API_NINJAS_KEY;
  if (!apiKey) {
    console.warn("API_NINJAS_KEY not configured — skipping API Ninjas lookup");
    return null;
  }

  try {
    const response = await fetch(
      `https://api.api-ninjas.com/v1/nutrition?query=${encodeURIComponent(query)}`,
      {
        headers: { "X-Api-Key": apiKey },
      },
    );

    if (!response.ok) {
      console.error(`API Ninjas error: ${response.status}`);
      return null;
    }

    const json = await response.json();
    const parsed = apiNinjasResponseSchema.safeParse(json);

    if (!parsed.success || parsed.data.length === 0) {
      return null;
    }

    const item = parsed.data[0];
    // If calories came back as 0 (premium-gated), this result is incomplete
    // but still useful for macro breakdown
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
      source: "api-ninjas" as const,
    };
  } catch (error) {
    console.error("API Ninjas lookup error:", error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Canadian Nutrient File (CNF) — Health Canada reference database
// Free API, no key required, supports English + French, ~5700 foods.
// Base: https://food-nutrition.canada.ca/api/canadian-nutrient-file/
// ---------------------------------------------------------------------------

interface CNFFood {
  food_code: number;
  food_description: string;
}

interface CNFNutrientAmount {
  food_code: number;
  nutrient_value: number;
  nutrient_name_id: number;
  nutrient_web_name: string;
}

// In-memory cache for the CNF food list (EN + FR).
// Loaded once on first use, ~60 ms from the government API.
let cnfFoodsEN: CNFFood[] | null = null;
let cnfFoodsFR: CNFFood[] | null = null;
let cnfFetchPromise: Promise<void> | null = null;

async function ensureCNFFoods(): Promise<void> {
  if (cnfFoodsEN && cnfFoodsFR) return;
  if (cnfFetchPromise) return cnfFetchPromise;

  cnfFetchPromise = (async () => {
    try {
      const [enRes, frRes] = await Promise.all([
        fetch(
          "https://food-nutrition.canada.ca/api/canadian-nutrient-file/food/?lang=en&type=json",
        ),
        fetch(
          "https://food-nutrition.canada.ca/api/canadian-nutrient-file/food/?lang=fr&type=json",
        ),
      ]);
      cnfFoodsEN = await enRes.json();
      cnfFoodsFR = await frRes.json();
      console.warn(
        `CNF loaded: ${cnfFoodsEN?.length} EN + ${cnfFoodsFR?.length} FR foods`,
      );
    } catch (_err) {
      console.warn("Failed to load CNF food lists:", err);
    }
    cnfFetchPromise = null;
  })();
  return cnfFetchPromise;
}

/**
 * Score how well a query matches a CNF food description.
 * CNF descriptions use "Category, food, qualifier" format, e.g.:
 *   "Sweets, sugars, granulated" or "Confiseries, sucre, granulé"
 * Returns 0 for no match, higher = better.
 */
function scoreCNFMatch(query: string, description: string): number {
  const q = query.toLowerCase().trim();
  const d = description.toLowerCase();

  // Exact match is best
  if (d === q) return 100;

  // Split description into comma-separated parts (category, name, qualifier)
  const parts = d.split(",").map((p) => p.trim());
  const qWords = q.split(/[\s,]+/).filter((w) => w.length > 1);
  if (qWords.length === 0) return 0;

  // Check word matches across the whole description
  let matched = 0;
  for (const word of qWords) {
    if (d.includes(word)) {
      matched++;
    } else if (word.endsWith("s") && d.includes(word.slice(0, -1))) {
      matched += 0.8;
    } else if (!word.endsWith("s") && d.includes(word + "s")) {
      matched += 0.8;
    }
  }

  if (matched === 0) return 0;

  // Base score from ratio of matched words
  let score = (matched / qWords.length) * 10;

  // Bonus: query matches a specific comma-separated part (not the category prefix).
  // Parts[1+] are the actual food name — matching those is much more relevant.
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    // Check if the query closely matches this part.
    // Only accept q.startsWith(part) when the part covers most of the query
    // (avoids "white sugars" falsely matching part "white" in "Beans, white, raw").
    if (
      part === q ||
      part.startsWith(q) ||
      (q.startsWith(part) && part.length >= q.length * 0.6)
    ) {
      score += 8; // Strong bonus for matching the food name part
      break;
    }
    // Check if all query words appear in this part
    const partMatchCount = qWords.filter((w) => part.includes(w)).length;
    if (partMatchCount === qWords.length) {
      score += 6;
      break;
    } else if (partMatchCount > 0) {
      score += partMatchCount * 2;
    }
  }

  // Bonus for matching the category (parts[0])
  const category = parts[0] || "";
  const catMatchCount = qWords.filter((w) => category.includes(w)).length;
  if (catMatchCount > 0) {
    score += catMatchCount * 1;
  }

  // Penalty for very long descriptions (less specific/relevant)
  score -= d.length / 100;

  // Penalty for descriptions with many parts (compound foods are less likely targets)
  if (parts.length > 3) score -= (parts.length - 3) * 0.5;

  return score;
}

/**
 * Fuzzy-match a search term against a list of CNF foods.
 * Returns the best match above a minimum threshold, or null.
 */
function fuzzyMatchCNF(query: string, foods: CNFFood[]): CNFFood | null {
  if (!query || query.trim().length === 0) return null;

  let best: CNFFood | null = null;
  let bestScore = 0;

  for (const food of foods) {
    const s = scoreCNFMatch(query, food.food_description);
    if (s > bestScore) {
      bestScore = s;
      best = food;
    }
  }

  // Require a minimum score to avoid false positives.
  // Score ~7 = only half the query words matched → too ambiguous.
  // Score ~10 = all words matched with some part relevance → good.
  return bestScore >= 8 ? best : null;
}

/**
 * Look up nutrition data from the Canadian Nutrient File (Health Canada).
 * Searches both English and French food lists for the best match,
 * then fetches nutrient amounts per 100 g.
 */
async function lookupCNF(query: string): Promise<NutritionData | null> {
  await ensureCNFFoods();
  if (!cnfFoodsEN || !cnfFoodsFR) return null;

  // Search both EN and FR food lists
  const matchEN = fuzzyMatchCNF(query, cnfFoodsEN);
  const matchFR = fuzzyMatchCNF(query, cnfFoodsFR);

  // Pick the match with the best score, preferring EN for display name
  let matchCode: number | null = null;
  if (matchEN && matchFR) {
    const scoreEN = scoreCNFMatch(query, matchEN.food_description);
    const scoreFR = scoreCNFMatch(query, matchFR.food_description);
    matchCode = scoreFR > scoreEN ? matchFR.food_code : matchEN.food_code;
  } else {
    matchCode = (matchEN || matchFR)?.food_code ?? null;
  }

  if (!matchCode) return null;

  // Always display the English name
  const enFood = cnfFoodsEN.find((f) => f.food_code === matchCode);
  const displayName =
    enFood?.food_description || matchFR?.food_description || query;

  console.warn(`CNF match for "${query}": ${displayName} (code: ${matchCode})`);

  try {
    const nutRes = await fetch(
      `https://food-nutrition.canada.ca/api/canadian-nutrient-file/nutrientamount/?lang=en&type=json&id=${matchCode}`,
    );
    const nutrients: CNFNutrientAmount[] = await nutRes.json();

    const findNutrient = (names: string[]): number => {
      for (const name of names) {
        const n = nutrients.find((nut) =>
          nut.nutrient_web_name.toLowerCase().includes(name.toLowerCase()),
        );
        if (n) return n.nutrient_value;
      }
      return 0;
    };

    const calories = findNutrient(["Energy (kcal)"]);
    // Skip results with 0 calories — likely wrong match
    if (calories === 0) return null;

    return {
      name: displayName,
      calories,
      protein: findNutrient(["Protein"]),
      carbs: findNutrient(["Carbohydrate"]),
      fat: findNutrient(["Total Fat"]),
      fiber: findNutrient(["Fibre"]),
      sugar: findNutrient(["Sugars"]),
      sodium: findNutrient(["Sodium"]),
      servingSize: "100g",
      source: "cnf",
    };
  } catch (err) {
    console.warn("CNF nutrient lookup error:", err);
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
 * Search USDA FoodData Central for a branded product by its UPC/GTIN barcode.
 * Tries multiple padding variants (raw, UPC-A with check digit, EAN-13).
 * Returns the product name + NutritionData if found.
 */
async function lookupUSDAByUPC(
  code: string,
): Promise<{ product: NutritionData; brandName?: string } | null> {
  const variants = barcodeVariants(code);

  for (const variant of variants) {
    try {
      const response = await fetch(
        `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${USDA_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: variant,
            dataType: ["Branded"],
            pageSize: 3,
          }),
        },
      );

      if (!response.ok) continue;
      const json = await response.json();
      if (!json.foods || json.foods.length === 0) continue;

      // Check that the UPC actually matches (text search can return false positives)
      const match = json.foods.find(
        (f: Record<string, unknown>) =>
          f.gtinUpc === variant ||
          f.gtinUpc === code ||
          f.gtinUpc === code.padStart(12, "0") ||
          f.gtinUpc === code.padStart(13, "0"),
      );
      if (!match) continue;

      const nutrients: { nutrientName: string; value: number }[] =
        match.foodNutrients || [];
      const findNutrient = (names: string[]): number => {
        for (const name of names) {
          const nutrient = nutrients.find((n) =>
            n.nutrientName?.toLowerCase().includes(name.toLowerCase()),
          );
          if (nutrient) return nutrient.value || 0;
        }
        return 0;
      };

      return {
        product: {
          name: match.description || "Unknown",
          calories: findNutrient(["Energy"]),
          protein: findNutrient(["Protein"]),
          carbs: findNutrient(["Carbohydrate"]),
          fat: findNutrient(["Total lipid", "Fat"]),
          fiber: findNutrient(["Fiber"]),
          sugar: findNutrient(["Sugars"]),
          sodium: findNutrient(["Sodium"]),
          servingSize: "100g",
          source: "usda",
        },
        brandName: match.brandOwner || match.brandName || undefined,
      };
    } catch (_err) {
      // Continue to next variant
    }
  }

  return null;
}

/**
 * Lookup nutrition data for a single item.
 * Canadian Nutrient File is tried first (bilingual, ideal for Canadian products).
 * USDA FoodData Central is the secondary source.
 * API Ninjas is used only as a last-resort fallback.
 */
export async function lookupNutrition(
  query: string,
): Promise<NutritionData | null> {
  // Check cache first
  const cached = await getCachedNutrition([query]);
  const cachedResult = cached.get(query);
  if (cachedResult) return cachedResult;

  // Primary: Canadian Nutrient File (bilingual, supports French product names)
  const cnfResult = await lookupCNF(query);
  if (cnfResult && cnfResult.calories > 0) {
    await cacheNutrition(query, cnfResult);
    return cnfResult;
  }

  // Secondary: USDA FoodData Central (reliable government data)
  const usdaResult = await lookupUSDA(query);
  if (usdaResult) {
    await cacheNutrition(query, usdaResult);
    return usdaResult;
  }

  // Last-resort fallback: API Ninjas
  const apiNinjasResult = await lookupAPINinjas(query);
  if (apiNinjasResult) {
    await cacheNutrition(query, apiNinjasResult);
  }
  return apiNinjasResult;
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

// ---------------------------------------------------------------------------
// Barcode lookup with cross-validation
// ---------------------------------------------------------------------------

export interface BarcodePer100g {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  fiber?: number;
  sugar?: number;
  sodium?: number;
}

export interface BarcodeServingInfo {
  displayLabel: string;
  grams: number;
  wasCorrected: boolean;
  correctionReason?: string;
}

export interface BarcodeLookupResult {
  productName: string;
  brandName?: string;
  imageUrl?: string;
  barcode: string;
  per100g: BarcodePer100g;
  perServing: BarcodePer100g;
  servingInfo: BarcodeServingInfo;
  isServingDataTrusted: boolean;
  source: string;
}

const MAX_PLAUSIBLE_SERVING_GRAMS = 500;
const MAX_PLAUSIBLE_SERVING_CALORIES = 800;

/**
 * Estimate a reasonable single-serving weight based on product category.
 */
function estimateServingGrams(
  productName: string,
  caloriesPer100g?: number,
): number {
  const lower = (productName || "").toLowerCase();
  if (/pod|k.cup|capsule|single serve/.test(lower)) return 15;
  if (lower.includes("bar")) return 40;
  if (/packet|sachet|pouch/.test(lower)) return 28;
  if (caloriesPer100g && caloriesPer100g > 0) {
    return Math.max(
      10,
      Math.min(200, Math.round((150 / caloriesPer100g) * 100)),
    );
  }
  return 30;
}

/**
 * Parse numeric grams from a serving size string like "30g" or "1 cup (240g)".
 */
function parseServingGrams(raw: string): number | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const m =
    lower.match(/\((\d+\.?\d*)\s*(?:g|ml)\)/) ||
    lower.match(/(\d+\.?\d*)\s*(?:g|ml)/);
  return m ? parseFloat(m[1]) : null;
}

/**
 * Scale all nutrition values by a factor, rounding to 1 decimal.
 */
function scaleNutrients(n: BarcodePer100g, factor: number): BarcodePer100g {
  const s = (v: number | undefined) =>
    v !== undefined ? Math.round(v * factor * 10) / 10 : undefined;
  return {
    calories:
      n.calories !== undefined ? Math.round(n.calories * factor) : undefined,
    protein: s(n.protein),
    carbs: s(n.carbs),
    fat: s(n.fat),
    fiber: s(n.fiber),
    sugar: s(n.sugar),
    sodium: s(n.sodium),
  };
}

/**
 * Normalize a NutritionData result (from API Ninjas/USDA) to per-100g.
 * API Ninjas returns values per serving_size_g; USDA returns per 100g.
 */
function normalizeToPerHundredGrams(data: NutritionData): BarcodePer100g {
  const grams = parseFloat(data.servingSize) || 100;
  const factor = 100 / grams;
  return {
    calories: Math.round(data.calories * factor),
    protein: Math.round(data.protein * factor * 10) / 10,
    carbs: Math.round(data.carbs * factor * 10) / 10,
    fat: Math.round(data.fat * factor * 10) / 10,
    fiber: Math.round(data.fiber * factor * 10) / 10,
    sugar: Math.round(data.sugar * factor * 10) / 10,
    sodium: Math.round(data.sodium * factor * 10) / 10,
  };
}

/**
 * Look up a barcode via Open Food Facts, then cross-validate per-100g
 * nutrition with USDA FoodData Central (and API Ninjas as fallback).
 *
 * Returns null only when no source has data for this barcode.
 */
/**
 * Compute the UPC-A check digit and return a 12-digit string.
 * Input can be any length ≤ 11; it will be left-padded with zeros.
 */
function computeUPCA(digits: string): string {
  const s = digits.padStart(11, "0");
  let odd = 0,
    even = 0;
  for (let i = 0; i < 11; i++) {
    if (i % 2 === 0) odd += parseInt(s[i]);
    else even += parseInt(s[i]);
  }
  const check = (10 - ((odd * 3 + even) % 10 || 0)) % 10;
  return s + check;
}

/**
 * Compute the EAN-13 check digit and return a 13-digit string.
 * Input can be any length ≤ 12; it will be left-padded with zeros.
 */
function computeEAN13(digits: string): string {
  const s = digits.padStart(12, "0");
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(s[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10 || 0)) % 10;
  return s + check;
}

/**
 * Generate barcode padding variants to try on Open Food Facts.
 * Scanners may return different digit counts than what OFF stores
 * (e.g. 10-digit scan vs 12-digit UPC-A vs 13-digit EAN-13).
 */
function barcodeVariants(code: string): string[] {
  const variants = new Set<string>();
  variants.add(code);

  // Zero-padded variants (no check digit)
  if (code.length < 13) {
    variants.add(code.padStart(12, "0")); // pad to UPC-A length
    variants.add(code.padStart(13, "0")); // pad to EAN-13 length
  }

  // With computed check digits
  if (code.length <= 11) {
    variants.add(computeUPCA(code)); // 12-digit UPC-A with check
  }
  if (code.length <= 12) {
    variants.add(computeEAN13(code)); // 13-digit EAN-13 with check
  }

  return [...variants];
}

export async function lookupBarcode(
  code: string,
): Promise<BarcodeLookupResult | null> {
  // ── Step 1: Fetch Open Food Facts (try padding variants) ─────────
  let offProduct: Record<string, any> | null = null;
  const codesToTry = barcodeVariants(code);

  for (const variant of codesToTry) {
    try {
      const res = await fetch(
        `https://world.openfoodfacts.org/api/v0/product/${variant}.json`,
      );
      const json = await res.json();
      if (json.status === 1 && json.product) {
        offProduct = json.product;
        console.warn(
          `Barcode ${code}: found in OFF as ${variant} (${variant.length} digits)`,
        );
        break;
      }
    } catch (err) {
      console.warn(`Open Food Facts fetch error for ${variant}:`, err);
    }
  }

  const productName: string = offProduct?.product_name || "";
  const brandName: string | undefined = offProduct?.brands || undefined;
  const imageUrl: string | undefined =
    offProduct?.image_url || offProduct?.image_front_url || undefined;
  const rawServing: string =
    offProduct?.serving_size || offProduct?.quantity || "";

  // Build search terms for cross-validation (CNF + USDA).
  // OFF products often have French/local names (e.g. "Sucre") that pure-English
  // databases can't match. We collect MULTIPLE terms to try:
  //   1. product_name_en  — explicit English name
  //   2. generic_name_en  — generic English name (e.g. "Granulated sugar")
  //   3. ALL English categories — from categories_tags, most specific first
  //      (e.g. "granulated sugars", "white sugars", "sugars", "sweeteners")
  //   4. generic_name     — often in English even for non-English products
  //   5. product_name     — last resort, may be in any language
  const searchTermCandidates: string[] = [];
  if (offProduct?.product_name_en) {
    searchTermCandidates.push(offProduct.product_name_en);
  }
  if (offProduct?.generic_name_en) {
    searchTermCandidates.push(offProduct.generic_name_en);
  }
  // Extract ALL English category tags (most specific first).
  // E.g. for sugar: ["white sugars", "granulated sugars", "sugars", "sweeteners"]
  // "granulated sugars" matches CNF "Sweets, sugars, granulated" perfectly.
  const catTags: string[] = offProduct?.categories_tags || [];
  const englishCats = [...catTags]
    .filter((t: string) => t.startsWith("en:"))
    .reverse() // most specific last in OFF → first after reverse
    .map((t: string) => t.replace("en:", "").replace(/-/g, " "));
  for (const cat of englishCats) {
    if (cat.trim().length > 0) {
      searchTermCandidates.push(cat);
    }
  }
  if (offProduct?.generic_name) {
    searchTermCandidates.push(offProduct.generic_name);
  }
  if (productName) {
    searchTermCandidates.push(productName);
  }
  // Pick the first non-empty candidate for USDA (best English term)
  const usdaSearchTerm =
    searchTermCandidates.find((t) => t.trim().length > 0)?.trim() || "";

  // ── Step 2: Extract OFF per-100g values ──────────────────────────
  const nm = offProduct?.nutriments || {};
  const offPer100g: BarcodePer100g = {
    calories:
      nm["energy-kcal_100g"] ??
      (nm.energy_100g !== undefined
        ? Math.round(nm.energy_100g / 4.184)
        : undefined),
    protein: nm.proteins_100g,
    carbs: nm.carbohydrates_100g,
    fat: nm.fat_100g,
    fiber: nm.fiber_100g,
    sugar: nm.sugars_100g,
    sodium:
      nm.sodium_100g !== undefined
        ? Math.round(nm.sodium_100g * 1000 * 10) / 10
        : undefined,
  };

  // ── Step 2b: If OFF has no product, try USDA branded food by UPC ─
  // Some products exist in USDA but not OFF (branded/US-market items).
  let usdaByUPC: { product: NutritionData; brandName?: string } | null = null;
  if (!offProduct) {
    console.warn(
      `Barcode ${code}: not in OFF — trying USDA branded food by UPC`,
    );
    usdaByUPC = await lookupUSDAByUPC(code);
    if (usdaByUPC) {
      console.warn(
        `Barcode ${code}: USDA UPC match — "${usdaByUPC.product.name}" (${usdaByUPC.product.calories} kcal/100g)`,
      );
    }
  }

  // ── Step 3: Cross-reference with CNF (Canadian) + USDA ───────────
  // Try multiple search terms and sources to find the best match.
  // CNF is ideal for Canadian products because it has both EN + FR names.
  let secondaryPer100g: BarcodePer100g | null = null;
  let secondarySource = "";

  // Build a de-duplicated list of all search terms to try with CNF.
  // More specific terms first (product_name_en, generic_name_en, categories).
  // We also add the raw product name last (may be French — CNF can match it).
  const cnfSearchTerms = new Set<string>();
  for (const term of searchTermCandidates) {
    const t = term.trim();
    if (t.length > 0) cnfSearchTerms.add(t);
  }

  for (const term of cnfSearchTerms) {
    try {
      console.warn(`Barcode ${code}: trying CNF for "${term}"`);
      const cnfResult = await lookupCNF(term);
      if (cnfResult && cnfResult.calories > 0) {
        secondaryPer100g = normalizeToPerHundredGrams(cnfResult);
        secondarySource = "cnf";
        console.warn(
          `Barcode ${code}: CNF matched "${cnfResult.name}" — ${secondaryPer100g.calories} kcal/100g`,
        );
        break; // Good match found, stop searching
      }
    } catch (err) {
      console.warn("CNF lookup failed:", err);
    }
  }

  // If CNF didn't match, fall back to USDA + API Ninjas
  if (!secondaryPer100g && usdaSearchTerm) {
    try {
      console.warn(
        `Barcode ${code}: CNF miss — trying USDA for "${usdaSearchTerm}"`,
      );
      const secondary = await lookupNutrition(usdaSearchTerm);
      if (secondary) {
        secondaryPer100g = normalizeToPerHundredGrams(secondary);
        secondarySource =
          secondary.source === "cache" ? "usda" : secondary.source;
      }
    } catch (err) {
      console.warn("Secondary nutrition lookup failed:", err);
    }
  }

  // ── Step 4: Pick the best per-100g values ────────────────────────
  let per100g = offPer100g;
  let source = "openfoodfacts";
  let resolvedProductName = productName;
  let resolvedBrandName = brandName;

  // If OFF had no product but USDA found it by UPC, use that as primary
  if (!offProduct && usdaByUPC) {
    per100g = normalizeToPerHundredGrams(usdaByUPC.product);
    source = "usda";
    resolvedProductName = usdaByUPC.product.name;
    resolvedBrandName = usdaByUPC.brandName || undefined;

    // Still try CNF/USDA text search for cross-validation
    if (secondaryPer100g && secondaryPer100g.calories !== undefined) {
      const ratio =
        per100g.calories !== undefined && per100g.calories > 0
          ? secondaryPer100g.calories / per100g.calories
          : 0;
      if (ratio >= 0.5 && ratio <= 2.0) {
        // Close enough — keep USDA UPC data, fill gaps
        per100g = {
          calories: per100g.calories,
          protein: per100g.protein ?? secondaryPer100g.protein,
          carbs: per100g.carbs ?? secondaryPer100g.carbs,
          fat: per100g.fat ?? secondaryPer100g.fat,
          fiber: per100g.fiber ?? secondaryPer100g.fiber,
          sugar: per100g.sugar ?? secondaryPer100g.sugar,
          sodium: per100g.sodium ?? secondaryPer100g.sodium,
        };
        source = "usda+verified";
      }
    }
  } else if (secondaryPer100g && secondaryPer100g.calories !== undefined) {
    if (
      offPer100g.calories !== undefined &&
      offPer100g.calories > 0 &&
      secondaryPer100g.calories > 0
    ) {
      // Both have data — compare. If >2× discrepancy, prefer secondary.
      const ratio = offPer100g.calories / secondaryPer100g.calories;
      if (ratio < 0.5 || ratio > 2.0) {
        console.warn(
          `Barcode ${code}: OFF=${offPer100g.calories} kcal/100g vs ${secondarySource}=${secondaryPer100g.calories} kcal/100g — using ${secondarySource}`,
        );
        per100g = secondaryPer100g;
        source = secondarySource;
      } else {
        // Close enough — use OFF (it has more product-specific detail)
        // but fill in any gaps from secondary
        per100g = {
          calories: offPer100g.calories,
          protein: offPer100g.protein ?? secondaryPer100g.protein,
          carbs: offPer100g.carbs ?? secondaryPer100g.carbs,
          fat: offPer100g.fat ?? secondaryPer100g.fat,
          fiber: offPer100g.fiber ?? secondaryPer100g.fiber,
          sugar: offPer100g.sugar ?? secondaryPer100g.sugar,
          sodium: offPer100g.sodium ?? secondaryPer100g.sodium,
        };
        source = "openfoodfacts+verified";
      }
    } else if (offPer100g.calories === undefined || offPer100g.calories === 0) {
      // OFF has no calorie data — use secondary
      per100g = secondaryPer100g;
      source = secondarySource;
    }
  }

  // If no data from any source, give up
  if (per100g.calories === undefined && !resolvedProductName) {
    return null;
  }

  // ── Step 5: Determine serving size ───────────────────────────────
  let servingGrams = parseServingGrams(rawServing);
  let wasCorrected = false;
  let correctionReason: string | undefined;

  if (servingGrams && per100g.calories !== undefined) {
    const calPerServing = (per100g.calories * servingGrams) / 100;
    if (
      calPerServing > MAX_PLAUSIBLE_SERVING_CALORIES ||
      servingGrams > MAX_PLAUSIBLE_SERVING_GRAMS
    ) {
      const estimated = estimateServingGrams(
        resolvedProductName,
        per100g.calories,
      );
      correctionReason = `Original serving (${rawServing}) appears to be the full package — adjusted to ~${estimated}g.`;
      servingGrams = estimated;
      wasCorrected = true;
    }
  }

  const finalGrams = servingGrams || 100;
  const scale = finalGrams / 100;

  return {
    productName: resolvedProductName || "Unknown Product",
    brandName: resolvedBrandName,
    imageUrl,
    barcode: code,
    per100g,
    perServing: scaleNutrients(per100g, scale),
    servingInfo: {
      displayLabel: wasCorrected
        ? `~${finalGrams}g (estimated)`
        : rawServing || `${finalGrams}g`,
      grams: finalGrams,
      wasCorrected,
      correctionReason,
    },
    isServingDataTrusted: !wasCorrected && source.includes("verified"),
    source,
  };
}

/**
 * Reset the in-memory CNF food list cache. Used by tests only.
 */
export function _resetCNFCacheForTesting(): void {
  cnfFoodsEN = null;
  cnfFoodsFR = null;
  cnfFetchPromise = null;
}
