import pLimit from "p-limit";
import { z } from "zod";
import { storage } from "../storage";
import { getStandardizedFoodName } from "./cultural-food-map";
import { createServiceLogger, toError } from "../lib/logger";
import { lookupCNF } from "./cnf-lookup";
import { lookupUSDA, UpstreamUnavailableError } from "./usda-lookup";
import type { NutritionData } from "./nutrition-source-utils";
import { FETCH_TIMEOUT_MS } from "./nutrition-source-utils";
import { cachedFetch } from "./dev-api-cache";

const log = createServiceLogger("nutrition-lookup");

// The source adapters live in their own modules; re-exported here so every
// consumer (and every vi.mock of this module) keeps one import path.
export type { NutritionData } from "./nutrition-source-utils";
export {
  fuzzyMatchCNF,
  lookupCNF,
  _resetCNFCacheForTesting,
} from "./cnf-lookup";
export { lookupUSDAByUPC } from "./usda-lookup";

// Rate limiting for parallel requests
const RATE_LIMIT = 5;
const limit = pLimit(RATE_LIMIT);

// Cache expiry: 7 days
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// Zod schema for API Ninjas nutrition response validation.
//
// Free tier gates calories and protein behind a non-numeric string
// ("Only available for premium subscribers.") instead of a real value.
// `coerceNumber` intentionally maps that string (and any other non-numeric
// value) to `0` for fields where `0` is the module's "incomplete" sentinel —
// `fetchNutritionFromSources`/`lookupNutrition`/`batchNutritionLookup` all
// gate on `calories > 0`, so this is a documented interface, not a leak
// (docs/solutions/conventions/sentinel-with-readers-is-a-contract-not-a-fabricated-default-2026-08-10.md).
// Never reject the parse over a gated string — that would fail every
// free-tier API Ninjas response outright (the retraction that doc records).
//
// That sentinel can't tell a gated `calories`/`protein_g` apart from a
// genuine numeric 0 (a real 0-kcal food — water, black coffee, diet soda —
// reaching API Ninjas as a last resort): both parse to `0` and look
// identical in the returned NutritionData. `numericOrGated` keeps the gated
// string as `null` instead, so `lookupAPINinjas` can refuse the whole
// result rather than return a food that looks like a real 0-kcal match
// (todo P2-2026-09-27).
const coerceNumber = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? v : 0));

const numericOrGated = z
  .union([z.number(), z.string()])
  .transform((v) => (typeof v === "number" ? v : null));

const apiNinjasItemSchema = z.object({
  name: z.string(),
  calories: numericOrGated,
  protein_g: numericOrGated,
  carbohydrates_total_g: coerceNumber,
  fat_total_g: coerceNumber,
  fiber_g: coerceNumber.optional().default(0),
  sugar_g: coerceNumber.optional().default(0),
  sodium_mg: coerceNumber.optional().default(0),
  serving_size_g: coerceNumber.optional().default(100),
});

// API Ninjas returns a raw array, not { items: [...] }
const apiNinjasResponseSchema = z.array(apiNinjasItemSchema);

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
  })
  // zod 4 infers a transformed field as a required key; OFF omits most of
  // these, and the `.catch(() => ({}))` fallback below has none of them.
  .optional();

export const offNutrimentsSchema = z
  .object({
    "energy-kcal_100g": offNumericField,
    energy_100g: offNumericField,
    "energy-kcal_serving": offNumericField,
    energy_serving: offNumericField,
    proteins_100g: offNumericField,
    carbohydrates_100g: offNumericField,
    fat_100g: offNumericField,
    fiber_100g: offNumericField,
    sugars_100g: offNumericField,
    sodium_100g: offNumericField,
    // Universal Nutrition Flags v1 (Task 2): carried/scaled here for typed
    // access; the actual OFF→per100g mapping + unit conversion (caffeine
    // g→mg, cholesterol g→mg) happens in a later task. `offNumericField`
    // (not `z.number().optional()`) is deliberate — this schema ends in a
    // top-level `.catch(() => ({}))`, so a strict field that throws on OFF's
    // occasional "N/A"/string garbage would wipe every nutrient (energy,
    // protein, …) for the product, not just this one. `offNumericField`
    // never throws and infers the same `number | undefined` output type.
    "saturated-fat_100g": offNumericField,
    "trans-fat_100g": offNumericField,
    cholesterol_100g: offNumericField,
    cholesterol_unit: z.string().optional().catch(undefined),
    caffeine_100g: offNumericField,
    caffeine_serving: offNumericField,
    caffeine_unit: z.string().optional().catch(undefined),
  })
  .passthrough()
  .catch(() => ({}));

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
 *
 * The free tier gates calories and protein behind a non-numeric string —
 * `numericOrGated` parses that as `null`, distinct from a genuine numeric 0.
 * A gated value can't be trusted as the food's actual energy or protein, so
 * a result with either field gated is refused entirely (see the `null` check
 * below) rather than returned as a food that looks like a real 0-kcal or
 * 0 g-protein match; the caller treats it the same as "not found" (todo
 * P2-2026-09-27).
 *
 * Null means API Ninjas answered with no usable food (or no key is
 * configured, which is a skipped source, not an outage). A non-OK response,
 * timeout or network error throws `UpstreamUnavailableError`.
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
      throw new UpstreamUnavailableError(`API Ninjas error ${response.status}`);
    }

    const json = await response.json();
    const parsed = apiNinjasResponseSchema.safeParse(json);

    if (!parsed.success || parsed.data.length === 0) {
      return null;
    }

    const item = parsed.data[0];
    if (item.calories === null || item.protein_g === null) {
      log.info(
        { query },
        "API Ninjas: calories or protein premium-gated — refusing result",
      );
      return null;
    }

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
    if (error instanceof UpstreamUnavailableError) throw error;
    log.error({ err: toError(error) }, "API Ninjas lookup error");
    throw new UpstreamUnavailableError("API Ninjas lookup failed");
  }
}

/**
 * Fetch nutrition data from external sources (CNF → USDA → API Ninjas) without
 * touching the cache. Used by both the single-item and batch lookup paths so
 * the batch can avoid a redundant per-item cache read (already a batch miss)
 * and a redundant cache write (batch writes once after this returns).
 *
 * CNF 0-calorie results fall through to USDA, matching the original guard at
 * the write site. USDA results are returned as-is; API Ninjas returns `null`
 * when its calories or protein are premium-gated (see `lookupAPINinjas`), otherwise
 * as-is. Callers apply the `calories > 0` write guard themselves for
 * whatever non-null result comes back.
 *
 * The query is looked up as typed first. A cultural food's standardized name
 * ("injera" → "fermented flatbread") is tried only when CNF and USDA both find
 * nothing: replacing the query up front looked up "buttermilk pancakes" as
 * "yogurt drink", and injera as "Crackers, flatbread" (412 kcal) although USDA
 * lists "Injera, Ethiopian bread" (93 kcal).
 */
async function fetchNutritionFromSources(
  query: string,
): Promise<NutritionData | null> {
  const standardizedQuery = getStandardizedFoodName(query);
  const queries =
    standardizedQuery !== query ? [query, standardizedQuery] : [query];

  // A provider that could not answer must not read as "not found". Keep
  // looking at the others; a result from any of them wins.
  let unavailable = false;
  const tryProvider = async (
    lookup: () => Promise<NutritionData | null>,
  ): Promise<NutritionData | null> => {
    try {
      return await lookup();
    } catch (error) {
      if (!(error instanceof UpstreamUnavailableError)) throw error;
      unavailable = true;
      return null;
    }
  };

  for (const q of queries) {
    // Primary: Canadian Nutrient File (bilingual, supports French product names)
    const cnfResult = await tryProvider(() => lookupCNF(q));
    if (cnfResult && cnfResult.calories > 0) return cnfResult;

    // Secondary: USDA FoodData Central (reliable government data)
    const usdaResult = await tryProvider(() => lookupUSDA(q));
    if (usdaResult) return usdaResult;
  }

  // Last-resort fallback: API Ninjas, with the query as typed — it parses
  // natural language, and the standardized names are vaguer search terms.
  const ninjasResult = await tryProvider(() => lookupAPINinjas(query));
  if (ninjasResult) return ninjasResult;

  // Nothing found. If ANY provider could not answer, "not found" is not
  // trustworthy (the one that was down may have had it), so report an outage
  // instead — stricter than the barcode path, which has OFF data to fall back
  // on and throws only when every source errored. Never cached by callers.
  if (unavailable) {
    throw new UpstreamUnavailableError("Nutrition lookup sources unavailable");
  }
  return null;
}

/**
 * Lookup nutrition data for a single item. Null means every source answered
 * and none has the food; `UpstreamUnavailableError` means nothing was found
 * and a source could not answer.
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
      let data: NutritionData | null = null;
      try {
        data = await fetchNutritionFromSources(item);
      } catch (error) {
        // An outage for one item must not fail the whole batch. It comes back
        // null (uncached), so a later call can still find it.
        if (!(error instanceof UpstreamUnavailableError)) throw error;
        log.warn({ item }, "nutrition sources unavailable for batch item");
      }
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
