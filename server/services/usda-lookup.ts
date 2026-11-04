import { z } from "zod";
import { createServiceLogger, toError } from "../lib/logger";
import { barcodeVariants } from "./barcode-policy";
import { cachedFetch } from "./dev-api-cache";
import {
  matchWords,
  withoutLeadingQuantity,
  wordMatch,
} from "./food-query-words";
import {
  FETCH_TIMEOUT_MS,
  findNutrientValue,
  type NutritionData,
} from "./nutrition-source-utils";

const log = createServiceLogger("nutrition-lookup");

/**
 * Thrown when a barcode lookup found no data AND every source it asked
 * errored (HTTP failure, rate limit, timeout, network) rather than answering
 * "no such product". Callers must not present this as "product not found" —
 * the right answer is a retryable 503.
 */
export class UpstreamUnavailableError extends Error {
  constructor(message = "Barcode lookup sources are unavailable") {
    super(message);
    this.name = "UpstreamUnavailableError";
  }
}

// Zod schema for USDA API response
const usdaFoodSchema = z.object({
  // Tolerate a missing/null description: the array is parsed as a whole but a
  // bad sibling food must not fail the page; readers fall back to "Unknown".
  description: z.string().nullish(),
  // "Foundation" | "SR Legacy" | "Survey (FNDDS)" | "Branded" — read by
  // lookupUSDA's candidate filter (todo P2-2026-09-27) to decide whether a
  // stricter head-match check applies. Absent/malformed degrades to
  // undefined rather than failing the sibling food, matching this schema's
  // existing tolerance for optional fields.
  dataType: z.string().nullish(),
  foodNutrients: z.array(
    z.object({
      nutrientName: z.string(),
      // A malformed unit degrades to undefined (read as kcal for energy)
      // instead of failing the whole `foods` array.
      unitName: z.string().nullish().catch(undefined),
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
// `servingSize`/`servingSizeUnit` are the label's real per-serving fields
// (e.g. `2.0` + `"GRM"`) — GDSN-sourced branded data is inconsistent enough
// (mixed casing, occasional bogus units) that these two must use `.catch()`,
// not bare `.nullish()`: a present-but-wrong-typed value (e.g. a string)
// would otherwise fail this one field, which fails the whole food object,
// which fails the whole `foods` array parse — regressing the *existing*,
// already-working USDA-by-UPC fallback for that barcode, not just the new
// serving-size feature. `.catch(undefined)` isolates the bad field instead.
const usdaUpcFoodSchema = usdaFoodSchema.extend({
  gtinUpc: z.string().optional(),
  brandOwner: z.string().optional(),
  brandName: z.string().optional(),
  servingSize: z.number().nullish().catch(undefined),
  servingSizeUnit: z.string().nullish().catch(undefined),
});

const usdaUpcResponseSchema = z.object({
  foods: z.array(usdaUpcFoodSchema),
});

// Warn at startup if using USDA DEMO_KEY (severe rate limits: 40 req/hour)
const USDA_API_KEY = process.env.USDA_API_KEY || "DEMO_KEY";
if (USDA_API_KEY === "DEMO_KEY") {
  log.warn("USDA_API_KEY not set — using DEMO_KEY with 40 requests/hour limit");
}

type UsdaNutrient = {
  nutrientName: string;
  unitName?: string | null;
  value: number;
};

const KJ_PER_KCAL = 4.184;

/**
 * Energy in kcal. SR Legacy foods list both a kJ and a kcal entry, in either
 * order (kJ first for "Quinoa, cooked": Energy 503 kJ, then 120 KCAL, live
 * 2026-09-27), so the first "Energy" match could store kJ as calories. Read
 * the kcal entry; convert a kJ-only energy; read an entry without a unit as
 * kcal. A Foundation food with only the two Atwater kcal entries gets the
 * first one USDA lists (General Factors in every sample), by array order, not
 * by a nutritional choice.
 */
function usdaKcal(nutrients: UsdaNutrient[]): number {
  const energy = nutrients.filter((n) =>
    n.nutrientName.toLowerCase().includes("energy"),
  );
  const unit = (n: UsdaNutrient) => n.unitName?.toLowerCase();
  const kcal =
    energy.find((n) => unit(n) === "kcal") ?? energy.find((n) => !unit(n));
  if (kcal) return kcal.value;
  const kj = energy.find((n) => unit(n) === "kj");
  return kj ? Math.round(kj.value / KJ_PER_KCAL) : 0;
}

/**
 * Map a parsed USDA food (search or branded-UPC shape) to NutritionData.
 * Both USDA endpoints return the same `{ nutrientName, unitName, value }`
 * nutrient shape, and the Zod schema already coerces a null `value` to 0, so
 * no `|| 0` is needed.
 */
function mapUsdaFoodToNutrition(food: {
  description?: string | null;
  foodNutrients: UsdaNutrient[];
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
    calories: usdaKcal(food.foodNutrients),
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
 * Whether every word of the query (whole word, singular/plural tolerant)
 * appears somewhere in a USDA candidate's description. A partial match — the
 * description missing even one query word — is rejected, the same rule
 * `scoreCNFMatch` applies to CNF (`server/services/nutrition-lookup.ts`).
 */
function usdaCoversQuery(description: string, qWords: string[]): boolean {
  const dWords = new Set(matchWords(description));
  return qWords.every((w) => wordMatch(dWords, w) > 0);
}

/**
 * Whether a description's head — its first comma-separated part, or the
 * whole description when it has no comma — is word-for-word the query: every
 * query word is in the head and every head word is in the query (plural
 * tolerant). Neither side may carry a content word the other lacks.
 */
function usdaHeadMatchesQuery(description: string, qWords: string[]): boolean {
  const headWords = matchWords(description.split(",")[0]);
  const headSet = new Set(headWords);
  const qSet = new Set(qWords);
  return (
    qWords.every((w) => wordMatch(headSet, w) > 0) &&
    headWords.every((w) => wordMatch(qSet, w) > 0)
  );
}

/**
 * Lookup nutrition data from USDA FoodData Central (fallback).
 *
 * Takes the first of up to 5 candidates (USDA's own relevance order) whose
 * description covers every query word. A `Branded` candidate additionally
 * must have the query as its exact head: a branded product's description is
 * a specific product name, and some products rank #1 for a query merely
 * because they share one of its words — "BAMBI, YO DORO WAFERS WITH
 * HAZELNUTS" for "doro wat", "GYOZA DIPPING SAUCE, GYOZA" for "gyoza" (a
 * trailing keyword-echo comma-part that satisfies plain word coverage even
 * though the product itself is unrelated). A generic (government reference:
 * Foundation/SR Legacy/Survey (FNDDS)) description is taxonomic and
 * legitimately carries extra qualifier words after the head — "Injera,
 * Ethiopian bread", "Biryani with vegetables", "Soup, pho, with meat" — so
 * the head-exact check is not applied there; it would wrongly reject them.
 * Measured live against the todo's full query set (todo P2-2026-09-27):
 * zero regressions among 15 previously-USDA-sourced queries, and both
 * "doro wat" and "gyoza" no longer resolve to the wrong branded row.
 */
export async function lookupUSDA(query: string): Promise<NutritionData | null> {
  try {
    const response = await cachedFetch(
      "usda",
      `https://api.nal.usda.gov/fdc/v1/foods/search?query=${encodeURIComponent(query)}&pageSize=5&api_key=${USDA_API_KEY}`,
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

    const qWords = withoutLeadingQuantity(matchWords(query));
    // A degenerate query with no real words (rare — e.g. a bare quantity)
    // can't be word-matched; fall back to USDA's own top hit as before.
    if (qWords.length === 0) {
      return mapUsdaFoodToNutrition(parsed.data.foods[0]);
    }

    const match = parsed.data.foods.find(
      (food) =>
        usdaCoversQuery(food.description ?? "", qWords) &&
        (food.dataType !== "Branded" ||
          usdaHeadMatchesQuery(food.description ?? "", qWords)),
    );

    return match ? mapUsdaFoodToNutrition(match) : null;
  } catch (error) {
    log.error({ err: toError(error) }, "USDA lookup error");
    return null;
  }
}

/**
 * USDA reports `servingSizeUnit` as a GDSN abbreviation ("GRM", "MLT") that
 * doesn't always match the lowercase "g"/"ml" the barcode-lookup serving-size
 * parser (`parseServingGrams`) expects — and sometimes returns plain "g"/"ml"
 * directly. Normalize only the two units we can convert with confidence; any
 * other unit (e.g. "MG", "OZ") is not safely convertible here (a wrong g/mg
 * mixup would be a 1000x data error) and is treated as absent.
 */
function normalizeUsdaServingUnit(unit: string): "g" | "ml" | null {
  const lower = unit.toLowerCase();
  if (lower === "g" || lower === "grm") return "g";
  if (lower === "ml" || lower === "mlt") return "ml";
  return null;
}

/**
 * Build a `parseServingGrams`-compatible serving-size string (e.g. "355ml")
 * from USDA's branded-food `servingSize`/`servingSizeUnit` fields, when both
 * are present and in a supported unit. Returns undefined when USDA has no
 * per-serving metadata for this food, or it's in a unit this codebase doesn't
 * convert — the caller then keeps its existing "no real serving data"
 * fallback (per-100g, `isServingDataTrusted: false`), never a guess.
 *
 * Deliberately does NOT use `householdServingFullText` ("1 CAN", "3/4
 * Teaspoon (2g)"): it's sometimes unit-free ("1 CAN"), which would show a
 * serving-looking label while the values underneath are still scaled at the
 * per-100g fallback — a label/scaling mismatch. `servingSize`+`servingSizeUnit`
 * is what actually drives the scaling math, so it's the only source used here.
 */
function usdaLabelServingSize(food: {
  servingSize?: number | null;
  servingSizeUnit?: string | null;
}): string | undefined {
  if (!food.servingSize || food.servingSize <= 0 || !food.servingSizeUnit) {
    return undefined;
  }
  const unit = normalizeUsdaServingUnit(food.servingSizeUnit);
  if (!unit) return undefined;
  return `${food.servingSize}${unit}`;
}

/**
 * Search USDA FoodData Central for a branded product by its UPC/GTIN barcode.
 * Tries multiple padding variants (raw, UPC-A with check digit, EAN-13).
 * Returns the product name + NutritionData if found.
 *
 * Returns null on a genuine miss (USDA answered, no matching product). Throws
 * `UpstreamUnavailableError` when nothing matched and EVERY variant attempt
 * failed (non-OK HTTP, rate limit, timeout, network) — an outage, not a miss.
 * A malformed 200 is treated as a miss, as before.
 */
export async function lookupUSDAByUPC(code: string): Promise<{
  product: NutritionData;
  brandName?: string;
  labelServingSize?: string;
} | null> {
  const variants = barcodeVariants(code);
  let answered = false;

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
      answered = true;
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
        labelServingSize: usdaLabelServingSize(match),
      };
    } catch {
      // Continue to next variant
    }
  }

  // No variant matched. If none even got an answer, that is an outage.
  if (!answered) {
    throw new UpstreamUnavailableError("USDA UPC lookup unavailable");
  }
  return null;
}
