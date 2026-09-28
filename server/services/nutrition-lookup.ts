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
 *
 * The free tier gates calories and protein behind a non-numeric string —
 * `numericOrGated` parses that as `null`, distinct from a genuine numeric 0.
 * A gated value can't be trusted as the food's actual energy or protein, so
 * a result with either field gated is refused entirely (see the `null` check
 * below) rather than returned as a food that looks like a real 0-kcal or
 * 0 g-protein match; the caller treats it the same as "not found" (todo
 * P2-2026-09-27).
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
        // Precompute each description's tokens once here, right after load,
        // instead of on first query — see `tokenizeDescription`.
        for (const food of [...cnfFoodsEN, ...cnfFoodsFR]) {
          tokenizeDescription(food.food_description.toLowerCase());
        }
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
 * Split text into lowercase whole words (letters, digits, "%"), dropping
 * one-letter words. Matching is by whole word: a substring test let "raw" match
 * "strawberry", "butter" match "butterfish" and "pap" match "paprika". CNF's
 * Canadian spelling "yogourt" is folded to "yogurt" so either spelling matches.
 */
function matchWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/yogourt/g, "yogurt")
    .split(/[^\p{L}\p{N}%]+/u)
    .filter((w) => w.length > 1 || /\d/.test(w));
}

/**
 * Serving units and sizes. Photo analysis ("<quantity> <name>") and cooking
 * sessions ("<quantity> <unit> <name>") prefix the query with these, and CNF
 * names never contain them, so that prefix must not count against the
 * every-word rule.
 */
const QUANTITY_UNITS = new Set([
  "cup",
  "cups",
  "tbsp",
  "tablespoon",
  "tablespoons",
  "tsp",
  "teaspoon",
  "teaspoons",
  "oz",
  "ounce",
  "ounces",
  "lb",
  "lbs",
  "pound",
  "pounds",
  "gram",
  "grams",
  "kg",
  "mg",
  "ml",
  "liter",
  "liters",
  "litre",
  "litres",
  "slice",
  "slices",
  "piece",
  "pieces",
  "serving",
  "servings",
  "can",
  "cans",
  "bottle",
  "bottles",
  "glass",
  "glasses",
  "bowl",
  "bowls",
  "handful",
  "handfuls",
  "small",
  "medium",
  "large",
  "pinch",
  "pinches",
  "dash",
  "dashes",
  "stalk",
  "stalks",
  "sprig",
  "sprigs",
  "bunch",
  "bunches",
  "head",
  "heads",
  "ear",
  "ears",
  "wedge",
  "wedges",
  "sheet",
  "sheets",
  "stick",
  "sticks",
  "container",
  "containers",
  "envelope",
  "envelopes",
]);

/**
 * A bare number or number+unit token ("2", "12oz", "200g"), never "2%".
 * No decimal branch: `matchWords` already splits "1.5"/"1,5" into "1" and
 * "5" on the non-letter/digit separator, so a word reaching this function
 * never contains "." or ",".
 */
function isNumberWord(word: string): boolean {
  const m = /^\d+([a-z]*)$/.exec(word);
  return (
    m !== null && (m[1] === "" || m[1] === "g" || QUANTITY_UNITS.has(m[1]))
  );
}

/**
 * Drop the leading quantity run ("1 cup", "2 large", "12oz", "1/2 cup") the
 * callers prepend. Only a run that STARTS with a number is dropped, and only up
 * to the first other word, so a unit word inside a food's own name stays:
 * "small white beans", "reese's pieces", "cup noodles". Residuals: "1 cup
 * noodles" loses "cup" (a joined string can't tell a unit from a name word),
 * and a quantity with no number ("a handful of almonds") is not stripped, so
 * it misses CNF and falls through to USDA.
 */
function withoutLeadingQuantity(words: string[]): string[] {
  if (words.length === 0 || !isNumberWord(words[0])) return words;
  let i = 0;
  while (
    i < words.length &&
    (isNumberWord(words[i]) || QUANTITY_UNITS.has(words[i]))
  ) {
    i++;
  }
  return words.slice(i);
}

/** 1 for the exact word, 0.8 for its singular/plural, 0 otherwise. */
function wordMatch(words: Set<string>, word: string): number {
  if (words.has(word)) return 1;
  const variants = [word + "s", word + "es"];
  if (word.endsWith("s")) variants.push(word.slice(0, -1));
  if (word.endsWith("es")) variants.push(word.slice(0, -2));
  if (word.endsWith("ies")) variants.push(word.slice(0, -3) + "y");
  if (word.endsWith("y")) variants.push(word.slice(0, -1) + "ies");
  return variants.some((v) => words.has(v)) ? 0.8 : 0;
}

/** Whether `words` begins with every word of `prefix`, in order. */
function startsWithWords(words: string[], prefix: string[]): boolean {
  return (
    prefix.length > 0 &&
    prefix.length <= words.length &&
    prefix.every((w, i) => wordMatch(new Set([words[i]]), w) > 0)
  );
}

const DEHYDRATED_WORDS = new Set([
  "dry",
  "dried",
  "powder",
  "dehydrated",
  "flour",
]);

/**
 * Whether the description is a dried, powdered or flour form the query did
 * not name. Four CNF spellings are not dehydrated products and do not count:
 * - a comma part that is only "dry": a grain or legume's raw state
 *   ("Grains, quinoa, dry", "Soybeans, dry, raw"), unlike "Milk, dry whole";
 * - "dry roasted": a roasting method ("Nuts, pecans, dry roasted"), whose
 *   sibling is "oil roasted";
 * - a comma part that is only "dried" on a Nuts or Seeds row: the plain
 *   shelled nut ("Nuts, pecans, dried"), which has no fresh form;
 * - a comma part that is only "dried" on a Spices row: the dried herb is the
 *   retail default ("Spices, thyme, dried" for bare "thyme"), unlike a
 *   Nuts/Seeds row, CNF also lists a "fresh" sibling for some spices
 *   (dill weed, rosemary, thyme, spearmint). Exempting the penalty restores
 *   a tie between the two rows, broken by list order (both score equally),
 *   not by a preference for "dried" — CNF happens to list "dried" first for
 *   dill weed/rosemary/thyme (so bare "thyme" resolves to dried, matching
 *   the pre-#1126 behaviour) and "fresh" first for spearmint (so bare
 *   "spearmint" still resolves to fresh). This is the same tie the scorer
 *   had before the dehydrated-form penalty was added; it is not a scored
 *   preference for "dried" and would change if CNF ever reordered its list.
 */
function isUnaskedDehydratedForm(
  parts: string[],
  partWordsList: string[][],
  qWords: string[],
): boolean {
  const exemptHead =
    parts[0] === "nuts" || parts[0] === "seeds" || parts[0] === "spices";
  return partWordsList.some((words) => {
    const soleWord = words.length === 1;
    return words.some(
      (w) =>
        DEHYDRATED_WORDS.has(w) &&
        !qWords.includes(w) &&
        !(w === "dry" && (soleWord || words.includes("roasted"))) &&
        !(w === "dried" && soleWord && exemptHead),
    );
  });
}

/**
 * Tokens derived from a CNF description, memoized per description string so
 * a query batch (`fuzzyMatchCNF` scores every query against the whole CNF
 * list) tokenizes each description at most once instead of on every query.
 * `ensureCNFFoods` warms this eagerly right after a successful load; a test
 * that passes an ad-hoc food list not loaded through `ensureCNFFoods` still
 * gets correct (if lazily computed) tokens via the cache-miss path.
 */
interface DescriptionTokens {
  dWords: Set<string>;
  parts: string[];
  partWordsList: string[][];
}
const descriptionTokenCache = new Map<string, DescriptionTokens>();

function tokenizeDescription(d: string): DescriptionTokens {
  const cached = descriptionTokenCache.get(d);
  if (cached) return cached;
  const parts = d.split(",").map((p) => p.trim());
  const tokens: DescriptionTokens = {
    dWords: new Set(matchWords(d)),
    parts,
    partWordsList: parts.map((p) => matchWords(p)),
  };
  descriptionTokenCache.set(d, tokens);
  return tokens;
}

/**
 * Score how well a query matches a CNF food description.
 * CNF descriptions use "Head, qualifier, qualifier" format, where the head is
 * either the food itself ("Egg, chicken, whole, raw", "Banana, raw") or a
 * category ("Grains, rice, white", "Sweets, sugars, granulated").
 * Returns 0 for no match, higher = better.
 *
 * Every query word must appear in the description (whole word, or its
 * singular/plural): a half match returns 0, so the lookup falls through to
 * USDA instead of settling on "Guava, strawberry, raw" for "almonds, raw".
 * A comma part that IS the query ranks above one that merely starts with it,
 * and the head part gets a small edge, so "egg" ranks the "Egg, chicken, …"
 * rows over "Bagel, egg" and "Egg Benedict".
 *
 * A dried, powdered or flour form the query didn't name loses a point, which
 * breaks a near tie: "milk" picks "Milk, fluid, …" over "Milk, dry whole".
 *
 * Measured on the 67-query gold set (`server/services/__tests__/fixtures/
 * cnf-gold-set.json`) against the real EN list (2026-09-27): right food 52,
 * wrong 11, no match 4. The base 51 queries alone are 43 / 4 / 4, unchanged
 * from before this file's fixes; before the dehydrated-form penalty (#1126)
 * they were 41 / 6 / 4, and the previous substring scorer got 12 / 37 / 2.
 * Residuals on the real list, none fixed (see the gold set for the measured
 * before/after of each): bare "egg" picks "Egg, chicken, yolk, cooked";
 * "rice" and bare "taco"/"tacos" pick a short dish name over CNF's longer
 * canonical row (the head-part edge and the parts-count penalty favour the
 * shorter description); "cocoa", "currant"/"currants" and "cherries" keep
 * losing to a processed or plural-spelled sibling even after the
 * dehydrated-form penalty (the penalty pushes the wrong direction for cocoa
 * and currant, whose common form IS processed/dried, and "cherries" loses
 * on the 0.8 plural-word-match discount, not the penalty). "thyme",
 * "rosemary" and "dill weed" are fixed — see `isUnaskedDehydratedForm`'s
 * Spices exemption. Open Food Facts product names with brand or form words
 * ("Hot Chocolate K-Cup Pods") fail the every-word rule, so barcode CNF
 * cross-validation fires less often for them than a plain CNF/CNF query.
 */
function scoreCNFMatch(query: string, description: string): number {
  const q = query.toLowerCase().trim();
  const d = description.toLowerCase();

  // Exact match is best
  if (d === q) return 100;

  const qWords = withoutLeadingQuantity(matchWords(q));
  if (qWords.length === 0) return 0;

  const { dWords, parts, partWordsList } = tokenizeDescription(d);
  const wordScores = qWords.map((w) => wordMatch(dWords, w));
  if (wordScores.some((s) => s === 0)) return 0;

  // Base score from how exactly the query words matched (plural = 0.8)
  let score = (wordScores.reduce((a, b) => a + b, 0) / qWords.length) * 10;

  // Bonus for a comma part that is, starts with, or contains the query.
  for (let i = 0; i < parts.length; i++) {
    const partWords = partWordsList[i];
    const headEdge = i === 0 ? 1 : 0;
    if (
      partWords.length === qWords.length &&
      startsWithWords(partWords, qWords)
    ) {
      score += 10 + headEdge;
      break;
    }
    if (
      startsWithWords(partWords, qWords) ||
      startsWithWords(qWords, partWords)
    ) {
      score += 8 + headEdge;
      break;
    }
    const partSet = new Set(partWords);
    const partMatchCount = qWords.filter((w) => wordMatch(partSet, w)).length;
    if (partMatchCount === qWords.length) {
      score += 6 + headEdge;
      break;
    }
    score += partMatchCount * 2;
  }

  // A dehydrated form shares its head with the fresh food, and its shorter
  // name would win the length tie-break ("milk" → "Milk, dry whole").
  if (isUnaskedDehydratedForm(parts, partWordsList, qWords)) score -= 1;

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
export function fuzzyMatchCNF(query: string, foods: CNFFood[]): CNFFood | null {
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

  // A partial word match already scored 0 in scoreCNFMatch. The floor for an
  // accepted row is 8: every word matched only via its singular/plural (0.8
  // each) with no comma-part bonus.
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
async function lookupUSDA(query: string): Promise<NutritionData | null> {
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
 */
export async function lookupUSDAByUPC(code: string): Promise<{
  product: NutritionData;
  brandName?: string;
  labelServingSize?: string;
} | null> {
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
        labelServingSize: usdaLabelServingSize(match),
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

  for (const q of queries) {
    // Primary: Canadian Nutrient File (bilingual, supports French product names)
    const cnfResult = await lookupCNF(q);
    if (cnfResult && cnfResult.calories > 0) return cnfResult;

    // Secondary: USDA FoodData Central (reliable government data)
    const usdaResult = await lookupUSDA(q);
    if (usdaResult) return usdaResult;
  }

  // Last-resort fallback: API Ninjas, with the query as typed — it parses
  // natural language, and the standardized names are vaguer search terms.
  return lookupAPINinjas(query);
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
  descriptionTokenCache.clear();
}
