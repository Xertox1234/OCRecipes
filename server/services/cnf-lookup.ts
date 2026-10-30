import { z } from "zod";
import { createServiceLogger, toError } from "../lib/logger";
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

/**
 * Reset the in-memory CNF food list cache. Used by tests only.
 */
export function _resetCNFCacheForTesting(): void {
  cnfFoodsEN = null;
  cnfFoodsFR = null;
  cnfFetchPromise = null;
  descriptionTokenCache.clear();
}
