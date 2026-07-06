import pLimit from "p-limit";
import { z } from "zod";
import { storage } from "../storage";
import { getStandardizedFoodName } from "./cultural-food-map";
import { createServiceLogger, toError } from "../lib/logger";
import { barcodeVariants } from "./barcode-lookup";
import { cachedFetch } from "./dev-api-cache";

const log = createServiceLogger("nutrition-lookup");

/** Generic nutrient search by substring match across a list of candidate names. */
function findNutrientValue<T>(
  nutrients: T[],
  getName: (n: T) => string,
  getValue: (n: T) => number,
  names: string[],
): number {
  for (const name of names) {
    const n = nutrients.find((nut) =>
      getName(nut).toLowerCase().includes(name.toLowerCase()),
    );
    if (n) return getValue(n);
  }
  return 0;
}

// Rate limiting for parallel requests
const RATE_LIMIT = 5;
const limit = pLimit(RATE_LIMIT);

// Cache expiry: 7 days
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// Timeout for outbound API requests (10 seconds)
const FETCH_TIMEOUT_MS = 10_000;

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
  // Tolerate a missing/null description: the array is parsed as a whole but a
  // bad sibling food must not fail the page; readers fall back to "Unknown".
  description: z.string().nullish(),
  foodNutrients: z.array(
    z.object({
      nutrientName: z.string(),
      // USDA returns `value: null` for no-data nutrients; `.default(0)` only
      // fires on `undefined`, so coerce null→0 (replicates the prior `|| 0`)
      // — otherwise one sibling food with a null value fails the whole page.
      value: z
        .number()
        .nullish()
        .transform((v) => v ?? 0),
    }),
  ),
});

const usdaResponseSchema = z.object({
  foods: z.array(usdaFoodSchema),
});

// USDA branded-food (UPC) search returns the same food shape plus brand/gtin
// fields. Validated so a malformed branded response can't poison the cache.
const usdaUpcFoodSchema = usdaFoodSchema.extend({
  gtinUpc: z.string().optional(),
  brandOwner: z.string().optional(),
  brandName: z.string().optional(),
});

const usdaUpcResponseSchema = z.object({
  foods: z.array(usdaUpcFoodSchema),
});

// Zod schema for Open Food Facts nutriments validation.
// OFF sometimes returns strings like "N/A" or null for unreported fields.
// Use drop-not-coerce: an unreadable value becomes undefined (absence), not 0.
// Never use z.coerce.number() here — it turns null/"N/A" → 0, poisoning the
// monetized cache with false zeros. .passthrough() + .catch(() => ({})) isolate
// one bad field from dropping the entire nutriments group.
const offNumericField = z
  .unknown()
  .catch(undefined)
  .transform((v) => {
    const n = parseFloat(String(v));
    return Number.isFinite(n) ? n : undefined;
  });

export const offNutrimentsSchema = z
  .object({
    "energy-kcal_100g": offNumericField,
    energy_100g: offNumericField,
    proteins_100g: offNumericField,
    carbohydrates_100g: offNumericField,
    fat_100g: offNumericField,
    fiber_100g: offNumericField,
    sugars_100g: offNumericField,
    sodium_100g: offNumericField,
  })
  .passthrough()
  .catch(() => ({}));

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

  try {
    const cached = await storage.getNutritionCacheBatch(
      items,
      normalizeForCache,
    );

    for (const [key, entry] of cached) {
      const data = entry.data as NutritionData;
      results.set(key, { ...data, source: "cache" });
    }
  } catch (error) {
    log.error({ err: toError(error) }, "cache lookup error");
  }

  return results;
}

/**
 * Write nutrition data to the cache (best-effort — catches + logs, never throws).
 *
 * `allowOverwrite` selects the storage policy:
 *  - `true`  → `setNutritionCache` (upsert via onConflictDoUpdate) for
 *              guaranteed-fresh lookup results from trusted sources.
 *  - `false` → `setNutritionCacheIfAbsent` (insert-or-ignore via
 *              onConflictDoNothing) for seeding from user-provided data
 *              (e.g. label scans keyed by an arbitrary barcode), which must
 *              never clobber an existing entry — guards against cache poisoning.
 */
async function writeNutritionCache(
  query: string,
  data: NutritionData,
  { allowOverwrite }: { allowOverwrite: boolean },
): Promise<void> {
  const key = normalizeForCache(query);
  const expiresAt = new Date(Date.now() + CACHE_EXPIRY_MS);
  const source = data.source === "cache" ? "usda" : data.source;

  try {
    if (allowOverwrite) {
      await storage.setNutritionCache(key, data.name, source, data, expiresAt);
    } else {
      await storage.setNutritionCacheIfAbsent(
        key,
        data.name,
        source,
        data,
        expiresAt,
      );
    }
  } catch (error) {
    log.error(
      { err: toError(error) },
      allowOverwrite ? "cache write error" : "cache seed write error",
    );
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
    log.warn("API_NINJAS_KEY not configured — skipping API Ninjas lookup");
    return null;
  }

  try {
    const response = await cachedFetch(
      "api-ninjas",
      `https://api.api-ninjas.com/v1/nutrition?query=${encodeURIComponent(query)}`,
      {
        headers: { "X-Api-Key": apiKey },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );

    if (!response.ok) {
      log.error({ status: response.status }, "API Ninjas error");
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
    log.error({ err: toError(error) }, "API Ninjas lookup error");
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
  food_code?: number | null;
  nutrient_value: number;
  nutrient_name_id?: number | null;
  nutrient_web_name: string;
}

// Validate the Health Canada CNF responses before they feed the nutrition
// pipeline — a malformed list/amount must skip CNF, not corrupt the cache.
const cnfFoodListSchema = z.array(
  z.object({ food_code: z.number(), food_description: z.string() }),
);
const cnfNutrientAmountListSchema = z.array(
  z.object({
    // Only nutrient_web_name + nutrient_value are read downstream; keep those
    // strict but tolerate null/absent on the unused keys so an upstream null in
    // a field we never touch can't drop an otherwise-valid nutrient set.
    food_code: z.number().nullish(),
    nutrient_value: z.number(),
    nutrient_name_id: z.number().nullish(),
    nutrient_web_name: z.string(),
  }),
);

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
        cachedFetch(
          "cnf",
          "https://food-nutrition.canada.ca/api/canadian-nutrient-file/food/?lang=en&type=json",
          { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
        ),
        cachedFetch(
          "cnf",
          "https://food-nutrition.canada.ca/api/canadian-nutrient-file/food/?lang=fr&type=json",
          { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
        ),
      ]);
      const enParsed = cnfFoodListSchema.safeParse(await enRes.json());
      const frParsed = cnfFoodListSchema.safeParse(await frRes.json());
      if (enParsed.success && frParsed.success) {
        cnfFoodsEN = enParsed.data;
        cnfFoodsFR = frParsed.data;
        log.info(
          { enCount: cnfFoodsEN.length, frCount: cnfFoodsFR.length },
          "CNF food lists loaded",
        );
      } else {
        log.warn(
          { enOk: enParsed.success, frOk: frParsed.success },
          "CNF food list failed validation — CNF source unavailable",
        );
      }
    } catch (err) {
      log.warn({ err: toError(err) }, "failed to load CNF food lists");
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
export async function lookupCNF(query: string): Promise<NutritionData | null> {
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

  log.debug({ query, match: displayName, code: matchCode }, "CNF match found");

  try {
    const nutRes = await cachedFetch(
      "cnf",
      `https://food-nutrition.canada.ca/api/canadian-nutrient-file/nutrientamount/?lang=en&type=json&id=${matchCode}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    const nutrientsParsed = cnfNutrientAmountListSchema.safeParse(
      await nutRes.json(),
    );
    if (!nutrientsParsed.success) {
      log.warn({ code: matchCode }, "CNF nutrient amounts failed validation");
      return null;
    }
    const nutrients: CNFNutrientAmount[] = nutrientsParsed.data;

    const findNutrient = (names: string[]) =>
      findNutrientValue(
        nutrients,
        (n) => n.nutrient_web_name,
        (n) => n.nutrient_value,
        names,
      );

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
    log.warn({ err: toError(err) }, "CNF nutrient lookup error");
    return null;
  }
}

// Warn at startup if using USDA DEMO_KEY (severe rate limits: 40 req/hour)
const USDA_API_KEY = process.env.USDA_API_KEY || "DEMO_KEY";
if (USDA_API_KEY === "DEMO_KEY") {
  log.warn("USDA_API_KEY not set — using DEMO_KEY with 40 requests/hour limit");
}

/**
 * Map a parsed USDA food (search or branded-UPC shape) to NutritionData.
 * Both USDA endpoints return the same `{ nutrientName, value }` nutrient shape,
 * and the Zod schema already coerces a null `value` to 0, so no `|| 0` is needed.
 */
function mapUsdaFoodToNutrition(food: {
  description?: string | null;
  foodNutrients: { nutrientName: string; value: number }[];
}): NutritionData {
  const findNutrient = (names: string[]) =>
    findNutrientValue(
      food.foodNutrients,
      (n) => n.nutrientName,
      (n) => n.value,
      names,
    );

  return {
    name: food.description || "Unknown",
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
}

/**
 * Lookup nutrition data from USDA FoodData Central (fallback)
 */
async function lookupUSDA(query: string): Promise<NutritionData | null> {
  try {
    const response = await cachedFetch(
      "usda",
      `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&pageSize=1&api_key=${USDA_API_KEY}`,
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );

    if (!response.ok) {
      return null;
    }

    const json = await response.json();
    const parsed = usdaResponseSchema.safeParse(json);

    if (!parsed.success || parsed.data.foods.length === 0) {
      return null;
    }

    return mapUsdaFoodToNutrition(parsed.data.foods[0]);
  } catch (error) {
    log.error({ err: toError(error) }, "USDA lookup error");
    return null;
  }
}

/**
 * Search USDA FoodData Central for a branded product by its UPC/GTIN barcode.
 * Tries multiple padding variants (raw, UPC-A with check digit, EAN-13).
 * Returns the product name + NutritionData if found.
 */
export async function lookupUSDAByUPC(
  code: string,
): Promise<{ product: NutritionData; brandName?: string } | null> {
  const variants = barcodeVariants(code);

  for (const variant of variants) {
    try {
      const response = await cachedFetch(
        "usda",
        `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${USDA_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query: variant,
            dataType: ["Branded"],
            pageSize: 3,
          }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        },
      );

      if (!response.ok) continue;
      const parsed = usdaUpcResponseSchema.safeParse(await response.json());
      if (!parsed.success || parsed.data.foods.length === 0) continue;

      // Check that the UPC actually matches (text search can return false positives)
      const match = parsed.data.foods.find(
        (f) =>
          f.gtinUpc === variant ||
          f.gtinUpc === code ||
          f.gtinUpc === code.padStart(12, "0") ||
          f.gtinUpc === code.padStart(13, "0"),
      );
      if (!match) continue;

      return {
        product: mapUsdaFoodToNutrition(match),
        brandName: match.brandOwner || match.brandName || undefined,
      };
    } catch {
      // Continue to next variant
    }
  }

  return null;
}

/**
 * Fetch nutrition data from external sources (CNF → USDA → API Ninjas) without
 * touching the cache. Used by both the single-item and batch lookup paths so
 * the batch can avoid a redundant per-item cache read (already a batch miss)
 * and a redundant cache write (batch writes once after this returns).
 *
 * CNF 0-calorie results fall through to USDA, matching the original guard at
 * the write site. USDA and API Ninjas results are returned as-is; callers
 * apply the `calories > 0` write guard themselves.
 */
async function fetchNutritionFromSources(
  query: string,
): Promise<NutritionData | null> {
  // Resolve cultural food names to standardized lookup terms
  const standardizedQuery = getStandardizedFoodName(query);
  const effectiveQuery =
    standardizedQuery !== query ? standardizedQuery : query;

  // Primary: Canadian Nutrient File (bilingual, supports French product names)
  const cnfResult = await lookupCNF(effectiveQuery);
  if (cnfResult && cnfResult.calories > 0) return cnfResult;

  // Secondary: USDA FoodData Central (reliable government data)
  const usdaResult = await lookupUSDA(effectiveQuery);
  if (usdaResult) return usdaResult;

  // Last-resort fallback: API Ninjas
  return lookupAPINinjas(effectiveQuery);
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
  // Check cache first (using original query for cache hits on cultural names)
  const cached = await getCachedNutrition([query]);
  const cachedResult = cached.get(query);
  if (cachedResult) return cachedResult;

  const result = await fetchNutritionFromSources(query);
  if (result && result.calories > 0) {
    await writeNutritionCache(query, result, { allowOverwrite: true });
  }
  return result;
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

  // Parallel lookup with rate limiting. Call fetchNutritionFromSources directly
  // to skip the per-item cache read (already proven a miss above) and to write
  // to cache exactly once per item (not twice as the previous lookupNutrition
  // call would have done).
  const lookupPromises = uncached.map((item) =>
    limit(async () => {
      const data = await fetchNutritionFromSources(item);
      if (data && data.calories > 0) {
        await writeNutritionCache(item, data, { allowOverwrite: true });
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

/**
 * Count non-null nutrition fields in data. Pure function for testability.
 */
export function countNonNullNutritionFields(data: {
  calories?: number | null;
  protein?: number | null;
  carbs?: number | null;
  fat?: number | null;
  fiber?: number | null;
  sugar?: number | null;
  sodium?: number | null;
}): number {
  let count = 0;
  if (data.calories != null) count++;
  if (data.protein != null) count++;
  if (data.carbs != null) count++;
  if (data.fat != null) count++;
  if (data.fiber != null) count++;
  if (data.sugar != null) count++;
  if (data.sodium != null) count++;
  return count;
}

/**
 * Map label extraction data to NutritionData format for cache storage.
 * Pure function for testability.
 */
export function mapLabelToNutritionData(labelData: {
  calories?: number | null;
  protein?: number | null;
  totalCarbs?: number | null;
  totalFat?: number | null;
  dietaryFiber?: number | null;
  totalSugars?: number | null;
  sodium?: number | null;
  servingSize?: string | null;
  productName?: string | null;
}): NutritionData {
  return {
    name: labelData.productName ?? "Label scan",
    calories: labelData.calories ?? 0,
    protein: labelData.protein ?? 0,
    carbs: labelData.totalCarbs ?? 0,
    fat: labelData.totalFat ?? 0,
    fiber: labelData.dietaryFiber ?? 0,
    sugar: labelData.totalSugars ?? 0,
    sodium: labelData.sodium ?? 0,
    servingSize: labelData.servingSize ?? "1 serving",
    source: "usda", // closest match for label data source
  };
}

/**
 * Cache nutrition data (exported for use by label endpoints).
 * Pass `{ allowOverwrite: false }` when seeding from user-provided data
 * (e.g. a label scan keyed by an arbitrary barcode) so an existing entry is
 * never clobbered — guards against cache poisoning.
 */
export { writeNutritionCache };

/**
 * Reset the in-memory CNF food list cache. Used by tests only.
 */
export function _resetCNFCacheForTesting(): void {
  cnfFoodsEN = null;
  cnfFoodsFR = null;
  cnfFetchPromise = null;
}
