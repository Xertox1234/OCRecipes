import { storage } from "../storage";
import { createServiceLogger, toError } from "../lib/logger";
import { roundToOneDecimal } from "../lib/math";
import { type BarcodePer100g, barcodeVariants } from "./barcode-policy";
import {
  buildSearchTermCandidates,
  extractOffPer100g,
  isOffSelfConsistent,
} from "./barcode-lookup-steps";
import { mapOffAllergenTags } from "./off-allergen-tags";
import { UpstreamUnavailableError } from "./usda-lookup";
import {
  lookupCNF,
  lookupNutrition,
  lookupUSDAByUPC,
  type NutritionData,
} from "./nutrition-lookup";

const log = createServiceLogger("barcode-lookup");

// Timeout for outbound API requests (10 seconds)
const FETCH_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// Barcode lookup with cross-validation
// ---------------------------------------------------------------------------

// Pure policy pieces (barcodeVariants, offMacrosCorroborateEnergy,
// offEnergyKcal, BarcodePer100g, ZERO_CAL_MAX_MACRO_KCAL_100G) live in the
// db-free barcode-policy.ts so operator tooling can import them without
// DATABASE_URL; the previously-public ones are re-exported below so existing
// consumers keep their import path.
export {
  barcodeVariants,
  offEnergyKcal,
  offMacrosCorroborateEnergy,
} from "./barcode-policy";
export type { BarcodePer100g } from "./barcode-policy";
export { UpstreamUnavailableError } from "./usda-lookup";

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
  // Phase 1 (Smart Scan): OFF-derived allergen data. Read live, NEVER persisted
  // to barcodeNutrition (ODbL). allergenDataAvailable === false is the
  // fail-dangerous signal for the flag evaluator. Availability means we have
  // ingredient text or an in-model allergen tag we can actually check
  // against — a tag outside our 9-allergen model doesn't count.
  ingredientsText?: string;
  allergenTags?: string[];
  allergenDataAvailable: boolean;
  // Phase 1 (Smart Scan): OFF-derived product-level NOVA/Nutri-Score/additive/
  // category data. Read live, NEVER persisted to barcodeNutrition (ODbL) —
  // same treatment as the allergen fields above.
  novaGroup?: number;
  nutriScore?: string;
  additivesTags?: string[];
  categoriesTags?: string[];
}

/**
 * Pull OFF allergen/ingredient content off the raw product. Pure + exported so
 * it can be unit-tested without mocking the OFF fetch. `allergenDataAvailable`
 * is true ONLY when we have ingredient text or an in-model allergen tag we can
 * actually check against — it is the fail-dangerous signal the flag evaluator
 * keys on. An in-model tag present but not matching the user's allergen is
 * still 'available' (we trust OFF's structured declaration for the allergens
 * it does model); only out-of-model-only tags with no ingredient text make it
 * 'unavailable', since OFF's raw `allergens_tags` includes tags outside our
 * 9-allergen model (e.g. mustard) that don't tell us anything we can check.
 */
export function extractOffAllergenData(
  offProduct: Record<string, any> | null,
): {
  ingredientsText?: string;
  allergenTags: string[];
  allergenDataAvailable: boolean;
} {
  const allergenTags: string[] = Array.isArray(offProduct?.allergens_tags)
    ? offProduct!.allergens_tags.filter(
        (t: unknown): t is string => typeof t === "string",
      )
    : [];
  const enText = offProduct?.ingredients_text_en;
  const rawText: unknown =
    typeof enText === "string" && enText.trim().length > 0
      ? enText
      : offProduct?.ingredients_text;
  const ingredientsText =
    typeof rawText === "string" && rawText.trim().length > 0
      ? rawText
      : undefined;
  const allergenDataAvailable =
    offProduct != null &&
    (ingredientsText !== undefined ||
      mapOffAllergenTags(allergenTags).length > 0);
  return { ingredientsText, allergenTags, allergenDataAvailable };
}

/**
 * Pull OFF product-level NOVA group, Nutri-Score grade, additives, and
 * category tags off the raw product. Pure + exported, mirroring
 * `extractOffAllergenData`'s defensive style so it can be unit-tested
 * without mocking the OFF fetch. `nutriScore` is lowercased (OFF's raw grade
 * casing is inconsistent); `novaGroup` is only set when OFF actually returns
 * a number. Both tag arrays default to `[]` for a null/absent product.
 */
export function extractOffUniversalData(
  offProduct: Record<string, any> | null,
): {
  novaGroup?: number;
  nutriScore?: string;
  additivesTags: string[];
  categoriesTags: string[];
} {
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
  const nova = offProduct?.nova_group;
  const grade = offProduct?.nutriscore_grade;
  return {
    novaGroup:
      typeof nova === "number"
        ? nova
        : typeof nova === "string" && /^[1-4]$/.test(nova.trim())
          ? Number(nova)
          : undefined,
    nutriScore: typeof grade === "string" ? grade.toLowerCase() : undefined,
    additivesTags: strArr(offProduct?.additives_tags),
    categoriesTags: strArr(offProduct?.categories_tags),
  };
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
 * Metric units as parseServingGrams accepts them. The trailing `\b` is baked
 * into this constant (not appended where it's used) so the alternation cannot
 * settle on a prefix (`g` inside `gallon`) in any regex built from it. The
 * `\b` alone does that work: JS alternation backtracks, so `(?:g|grams?)\b`
 * still reads "grams" correctly and reordering the alternatives changes no
 * parse result, only backtracking cost. Do NOT assume inserting a new
 * spelling "in the right position" is sufficient — it must end at a word
 * boundary, and it must be pinned by a test.
 *
 * Vocabulary started from the sibling constant `shared/lib/label-serving.ts`'s
 * UNIT — kept local rather than imported, since that module's own docblock
 * deliberately leaves this function's callers alone — and then widened,
 * because this function parses OFF's crowdsourced free-text `serving_size`
 * field rather than OCR'd printed labels: informal abbreviations
 * (`gm`/`gms`), the British `gramme(s)`, and non-English spellings
 * (`grammi`/`gramos`/`gramas`/`gramm`, plus `grs`/`grm`) all appear there and
 * were all accepted by the predecessor prefix-match.
 *
 * Bare `gr` is deliberately NOT accepted: on its own it is the symbol for the
 * apothecary "grain", a genuinely different mass, and unit symbols do not
 * pluralize — so `grs`/`grm` are not grain abbreviations and are safe to
 * accept. That judgment is this module's own, not inherited from the sibling
 * constant (which mentions neither `gr` nor `grain`).
 */
const SERVING_UNIT = String.raw`(?:grammes?|grammi|gramm|grams?|gramos|gramas|gms?|grs|grm|g|millilit(?:re|er)s?|mls?)\b`;

/**
 * The serving figure. `\.\d*` reproduces the predecessor's dot handling
 * exactly; `,\d{1,2}` adds the continental-European decimal comma ("12,5 g"),
 * which the European unit spellings above made reachable — without it the
 * engine skips the "12," and matches the trailing "5", returning a plausible
 * but 2.5x-wrong basis.
 *
 * The `{1,2}` bound is load-bearing, not tidying: a comma before exactly three
 * digits is genuinely ambiguous ("1,000" is 1 in the EU and 1000 in the US),
 * so the group declines to consume it and the value is refused rather than
 * guessed at. A plain `[.,]?\d*` here would read "1,000 g" as 1 g — newly
 * ACCEPTING a 1000x-wrong basis where today's code rejects it.
 *
 * Commas are normalized to `.` in `parseServingGrams` before `parseFloat`,
 * which understands only `.`.
 */
const SERVING_FIGURE = String.raw`(\d+(?:\.\d*|,\d{1,2})?)`;

const SERVING_GRAMS_PAREN = new RegExp(
  String.raw`\(${SERVING_FIGURE}\s*${SERVING_UNIT}\)`,
);
const SERVING_GRAMS_BARE = new RegExp(
  String.raw`${SERVING_FIGURE}\s*${SERVING_UNIT}`,
);

/**
 * Parse a numeric serving basis from a serving size string like "30g" or
 * "1 cup (240g)".
 *
 * The unit is matched as a whole word (trailing `\b`): "1 gallon" and
 * "2 glasses" must not read as 1 and 2 grams just because their unit begins
 * with "g" — the old alternation had no boundary and accepted any unit that
 * merely started with "g" or "ml".
 *
 * CAVEAT — the return is named grams but volume units are accepted and
 * returned UNCONVERTED, i.e. assuming density = 1 g/ml. That is close enough
 * for water-like drinks (and "250 millilitres" reading as 250 is a genuine
 * improvement over refusing it outright), but it is wrong wherever density
 * isn't ~1: oils (~0.92, ~8% over-reported), syrups (~1.4, ~29%
 * under-reported), spirits (~0.79, ~21% over-reported). A real conversion
 * needs a per-product density, which OFF does not reliably carry, so it is
 * deliberately not attempted here.
 */
export function parseServingGrams(raw: string): number | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const m = lower.match(SERVING_GRAMS_PAREN) || lower.match(SERVING_GRAMS_BARE);
  return m ? parseFloat(m[1].replace(",", ".")) : null;
}

/**
 * Scale all nutrition values by a factor, rounding to 1 decimal.
 */
export function scaleNutrients(
  n: BarcodePer100g,
  factor: number,
): BarcodePer100g {
  const s = (v: number | undefined) =>
    v !== undefined ? roundToOneDecimal(v * factor) : undefined;
  return {
    calories:
      n.calories !== undefined ? Math.round(n.calories * factor) : undefined,
    protein: s(n.protein),
    carbs: s(n.carbs),
    fat: s(n.fat),
    fiber: s(n.fiber),
    sugar: s(n.sugar),
    sodium: s(n.sodium),
    saturatedFat: s(n.saturatedFat),
    transFat: s(n.transFat),
    cholesterol: s(n.cholesterol),
    caffeine: s(n.caffeine),
  };
}

/**
 * Normalize a NutritionData result (from API Ninjas/USDA) to per-100g.
 * API Ninjas returns values per serving_size_g; USDA returns per 100g.
 *
 * Returns `null` when `servingSize` cannot be placed on a gram basis. Callers
 * MUST discard the result rather than substitute a default: these values feed
 * `reconcilePer100g`, which can replace a product's primary nutrition, so a
 * fabricated basis is a wrong-number path with no user-visible disclosure.
 *
 * Uses `parseServingGrams` rather than `parseFloat` because `parseFloat` reads
 * the leading count of a compound string and silently mis-scales by it:
 * `"1 serving"` -> 1 -> factor 100 (every nutrient inflated 100x), and
 * `"1 cup (240g)"` -> 1 -> factor 100 where the correct factor is 100/240.
 * The old `|| 100` fallback never even fired for those — it only caught the
 * non-numeric-prefix case, and it also swallowed a legitimate 0.
 */
export function normalizeToPerHundredGrams(
  data: NutritionData,
): BarcodePer100g | null {
  const grams = parseServingGrams(data.servingSize);
  // `!(grams > 0)` rather than `<= 0` so a NaN basis is rejected too.
  if (grams === null || !(grams > 0)) return null;
  const factor = 100 / grams;
  return {
    calories: Math.round(data.calories * factor),
    protein: roundToOneDecimal(data.protein * factor),
    carbs: roundToOneDecimal(data.carbs * factor),
    fat: roundToOneDecimal(data.fat * factor),
    fiber: roundToOneDecimal(data.fiber * factor),
    sugar: roundToOneDecimal(data.sugar * factor),
    sodium: roundToOneDecimal(data.sodium * factor),
  };
}

/**
 * Reconcile a primary per-100g result against a secondary cross-validation
 * source, returning the chosen per-100g values and the source label.
 *
 * Decision policy (calorie-ratio based, threshold [0.5, 2.0], inversion-symmetric):
 *  - **Agree** (both calories > 0 and within ratio threshold): keep the primary
 *    calories and gap-fill any missing macro fields from the secondary; the
 *    source becomes `"<primaryLabel>+verified"`.
 *  - **Disagree** (out-of-range ratio, or the primary has no/zero calories):
 *    replace with the secondary *only when* `preferSecondaryOnDiscrepancy` is set
 *    (OFF primaries trust the secondary; USDA-UPC primaries never replace).
 *  - Otherwise keep the primary unchanged. If a REAL disagreement (both sides
 *    positive) was rejected specifically because `preferSecondaryOnDiscrepancy`
 *    was false (i.e. the primary's own self-consistency check overrode it),
 *    the source becomes `"<primaryLabel>+self-consistent"` instead of the plain
 *    label — this distinguishes "a disagreeing secondary was outright
 *    rejected" from "no secondary was ever found" for API consumers (todo
 *    P3-2026-07-17-off-self-consistency-gate-refinements). A secondary with no
 *    usable (positive) calories never triggers this marker — there was no real
 *    disagreement to reject.
 *
 * @param preferSecondaryOnDiscrepancy `true` for OFF primaries (replace on
 *   disagreement), `false` for USDA-UPC primaries (only ever gap-fill).
 * @param code barcode, used only for the discrepancy debug log.
 */
function reconcilePer100g(
  primary: BarcodePer100g,
  secondary: BarcodePer100g | null,
  secondarySource: string,
  primaryLabel: string,
  preferSecondaryOnDiscrepancy: boolean,
  code: string,
): { per100g: BarcodePer100g; source: string } {
  if (!secondary || secondary.calories === undefined) {
    return { per100g: primary, source: primaryLabel };
  }

  const pc = primary.calories;
  const sc = secondary.calories;
  const bothPositive = pc !== undefined && pc > 0 && sc > 0;
  const ratio = bothPositive ? pc! / sc : 0;
  const agree = bothPositive && ratio >= 0.5 && ratio <= 2.0;

  if (agree) {
    // Close enough — keep primary calories, fill gaps from secondary.
    return {
      per100g: {
        calories: pc,
        protein: primary.protein ?? secondary.protein,
        carbs: primary.carbs ?? secondary.carbs,
        fat: primary.fat ?? secondary.fat,
        fiber: primary.fiber ?? secondary.fiber,
        sugar: primary.sugar ?? secondary.sugar,
        sodium: primary.sodium ?? secondary.sodium,
        saturatedFat: primary.saturatedFat ?? secondary.saturatedFat,
        transFat: primary.transFat ?? secondary.transFat,
        cholesterol: primary.cholesterol ?? secondary.cholesterol,
        caffeine: primary.caffeine ?? secondary.caffeine,
      },
      source: `${primaryLabel}+verified`,
    };
  }

  const primaryMissing = pc === undefined || pc === 0;
  if (preferSecondaryOnDiscrepancy && (bothPositive || primaryMissing)) {
    // >2× discrepancy (bothPositive) or no primary calories — prefer secondary.
    if (bothPositive) {
      log.debug(
        {
          barcode: code,
          offCalories: pc,
          secondaryCalories: sc,
          selectedSource: secondarySource,
        },
        "calorie discrepancy — using secondary source",
      );
    }
    return { per100g: secondary, source: secondarySource };
  }

  // Reaching here with bothPositive true means a real (both-sides-positive)
  // disagreement existed and was NOT replaced — the only way that happens is
  // preferSecondaryOnDiscrepancy being false, i.e. the primary's own
  // self-consistency check rejected the secondary. bothPositive false means
  // the secondary simply had no usable calories — nothing was "rejected".
  const rejectedDisagreeingSecondary =
    !preferSecondaryOnDiscrepancy && bothPositive;
  return {
    per100g: primary,
    source: rejectedDisagreeingSecondary
      ? `${primaryLabel}+self-consistent`
      : primaryLabel,
  };
}

/**
 * Step 1: fetch Open Food Facts, trying barcode padding variants.
 * `offAnswered` is true once any variant gave a definitive answer.
 */
async function fetchOffProduct(
  code: string,
): Promise<{ offProduct: Record<string, any> | null; offAnswered: boolean }> {
  // Open Food Facts returns deeply nested, loosely-typed product objects.
  // Using `any` here is pragmatic — a full interface would be brittle and unmaintainable.
  let offProduct: Record<string, any> | null = null;
  const codesToTry = barcodeVariants(code);
  // True once any OFF variant gave a definitive answer ("status 0" counts,
  // even on an HTTP 404). Stays false only if every attempt errored.
  let offAnswered = false;

  for (const variant of codesToTry) {
    try {
      const res = await fetch(
        `https://world.openfoodfacts.org/api/v0/product/${variant}.json`,
        {
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          // OFF's API terms ask for an identifying User-Agent (app + contact).
          headers: { "User-Agent": "OCRecipes/1.0 (https://ocrecipes.com)" },
        },
      );
      const json = await res.json();
      if (json.status === 0) offAnswered = true;
      else if (!res.ok) {
        log.warn("Open Food Facts returned a non-OK response without a status");
        continue;
      }
      if (json.status === 1 && json.product) {
        offAnswered = true;
        offProduct = json.product;
        log.debug(
          { barcode: code, variant, digits: variant.length },
          "barcode found in OFF",
        );
        break;
      }
    } catch (err) {
      log.warn({ err: toError(err) }, "Open Food Facts fetch error");
    }
  }
  return { offProduct, offAnswered };
}

/**
 * Step 3: cross-reference with CNF (Canadian) + USDA/API Ninjas, returning a
 * normalized per-100g secondary source (or null when none matched).
 */
async function findSecondaryPer100g(
  code: string,
  searchTermCandidates: string[],
  usdaSearchTerm: string,
): Promise<{
  secondaryPer100g: BarcodePer100g | null;
  secondarySource: string;
}> {
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
      log.debug({ barcode: code, term }, "trying CNF lookup");
      const cnfResult = await lookupCNF(term);
      if (cnfResult && cnfResult.calories > 0) {
        const normalized = normalizeToPerHundredGrams(cnfResult);
        if (!normalized) {
          // Discard rather than cross-validate against a basis we cannot
          // place. Keep searching the remaining terms — a later one may
          // return a match we can normalize.
          log.warn(
            {
              match: cnfResult.name,
              servingSize: cnfResult.servingSize,
            },
            "CNF match discarded — serving size has no gram basis",
          );
          continue;
        }
        secondaryPer100g = normalized;
        secondarySource = "cnf";
        log.debug(
          {
            barcode: code,
            match: cnfResult.name,
            calories: secondaryPer100g.calories,
          },
          "CNF match for barcode",
        );
        break; // Good match found, stop searching
      }
    } catch (err) {
      log.warn({ err: toError(err) }, "CNF lookup failed");
    }
  }

  // If CNF didn't match, fall back to USDA + API Ninjas
  if (!secondaryPer100g && usdaSearchTerm) {
    try {
      log.debug(
        { barcode: code, searchTerm: usdaSearchTerm },
        "CNF miss — trying USDA",
      );
      const secondary = await lookupNutrition(usdaSearchTerm);
      if (secondary) {
        const normalized = normalizeToPerHundredGrams(secondary);
        if (normalized) {
          secondaryPer100g = normalized;
          secondarySource =
            secondary.source === "cache" ? "usda" : secondary.source;
        } else {
          // Leave both `secondaryPer100g` and `secondarySource` unset so
          // reconcilePer100g sees exactly the "no secondary was found" state
          // and the source label keeps its plain form.
          log.warn(
            {
              source: secondary.source,
              servingSize: secondary.servingSize,
            },
            "secondary nutrition discarded — serving size has no gram basis",
          );
        }
      }
    } catch (err) {
      log.warn({ err: toError(err) }, "secondary nutrition lookup failed");
    }
  }
  return { secondaryPer100g, secondarySource };
}

/**
 * Step 5: determine the serving size, correcting implausible (whole-package)
 * servings, and scale per-100g values to it.
 */
function resolveServing(
  rawServing: string,
  per100g: BarcodePer100g,
  productName: string,
) {
  let servingGrams = parseServingGrams(rawServing);
  // Captured BEFORE the correction block below can reassign `servingGrams` —
  // this must reflect whether the source actually gave us real serving data,
  // not the (possibly estimated) value servingGrams holds afterward. `> 0`
  // guards a pathological "0 ml" parse: `finalGrams = servingGrams || 100`
  // already treats 0 as "no serving data" downstream, so trust must agree.
  const hasServingData = servingGrams !== null && servingGrams > 0;
  let wasCorrected = false;
  let correctionReason: string | undefined;

  if (servingGrams && per100g.calories !== undefined) {
    const calPerServing = (per100g.calories * servingGrams) / 100;
    if (
      calPerServing > MAX_PLAUSIBLE_SERVING_CALORIES ||
      servingGrams > MAX_PLAUSIBLE_SERVING_GRAMS
    ) {
      const estimated = estimateServingGrams(productName, per100g.calories);
      correctionReason = `Original serving (${rawServing}) appears to be the full package — adjusted to ~${estimated}g.`;
      servingGrams = estimated;
      wasCorrected = true;
    }
  }

  const finalGrams = servingGrams || 100;
  const scale = finalGrams / 100;
  // Hoisted so both the storage write below and the returned result use the
  // SAME per-serving values as `servingSize` — writing `per100g` values next
  // to a real per-serving `servingSize` label (e.g. "30g") would understate
  // the true serving size's calorie mismatch by the scale factor (a 30g
  // serving at 400 kcal/100g is ~120 kcal, not 400). Previously masked in the
  // USDA-by-UPC branch only because `rawServing` was always "" there, so
  // `servingSize` always fell back to `${finalGrams}g` (100g), which happens
  // to equal the per100g denominator.
  const perServing = scaleNutrients(per100g, scale);
  return {
    finalGrams,
    wasCorrected,
    correctionReason,
    hasServingData,
    perServing,
  };
}

/**
 * Look up a barcode via Open Food Facts, then cross-validate per-100g
 * nutrition with USDA FoodData Central (and API Ninjas as fallback).
 *
 * Returns null only when no source has data for this barcode. Throws
 * `UpstreamUnavailableError` when nothing was found AND neither Open Food
 * Facts nor USDA could answer (every attempt errored) — an outage, which the
 * caller must not report as "not found".
 */
export async function lookupBarcode(
  code: string,
): Promise<BarcodeLookupResult | null> {
  const { offProduct, offAnswered } = await fetchOffProduct(code);

  const productName: string = offProduct?.product_name || "";
  const brandName: string | undefined = offProduct?.brands || undefined;
  const imageUrl: string | undefined =
    offProduct?.image_url || offProduct?.image_front_url || undefined;
  // `serving_size` is a labeled per-serving amount; `quantity` is usually the
  // whole package's net weight, not a serving. Do NOT fall back to `quantity`
  // here — it used to feed both the display label and the scaling math below,
  // so a package quantity that happened to parse under the plausibility
  // thresholds (see Step 5) could slip through untagged as a trusted,
  // correctly-scaled serving. Omitting it makes a quantity-only product
  // behave exactly like the (already-correct) "no serving data" case: falls
  // back to per-100g values with `isServingDataTrusted: false`. There is no
  // valid partial-trust middle ground for `quantity` — it's the wrong field
  // semantically, not merely a weaker version of the right one. If real
  // per-serving data needs recovering for quantity-only products in the
  // future, OFF's numeric `serving_quantity` field is the correct source
  // (currently unused here) — never re-add `quantity` as a fallback.
  //
  // `let`, not `const`: in the USDA-by-UPC branch below (Step 2b/4, no OFF
  // product at all), this gets overridden with USDA's own confirmed
  // per-serving label (`usdaByUPC.labelServingSize`) when USDA provides one.
  // That is a DIFFERENT source than OFF's `quantity` — it's USDA's dedicated
  // `servingSize`/`servingSizeUnit` label fields, not a package-weight guess
  // — so this does not reintroduce the `quantity` conflation above.
  let rawServing: string = offProduct?.serving_size || "";

  // Search terms for cross-validation (CNF + USDA) — rules live in
  // buildSearchTermCandidates (barcode-lookup-steps.ts).
  const searchTermCandidates = buildSearchTermCandidates(offProduct);
  const usdaSearchTerm =
    searchTermCandidates.find((t) => t.trim().length > 0)?.trim() || "";

  // Phase 1 (Smart Scan): OFF allergen/ingredient data, read live and surfaced
  // on the result only — NEVER persisted (see barcodeNutrition insert below).
  const offAllergenData = extractOffAllergenData(offProduct);
  // Phase 1 (Smart Scan): OFF product-level NOVA/Nutri-Score/additives/
  // categories, same read-live-only treatment as offAllergenData above.
  const offUniversalData = extractOffUniversalData(offProduct);

  // ── Step 2: Extract OFF per-100g values ──────────────────────────
  // Boundary validation + plausibility bounds live in extractOffPer100g.
  const offExtraction = extractOffPer100g(offProduct);
  const { per100g: offPer100g, dropped: offDroppedFields } = offExtraction;
  if (offDroppedFields.length > 0) {
    log.warn(
      { dropped: offDroppedFields },
      "implausible OFF per-100g values dropped",
    );
  }

  // Self-consistency verdict (rules documented on isOffSelfConsistent): a
  // self-consistent label demotes the secondary source to gap-fill only.
  const offSelfConsistent = isOffSelfConsistent({
    per100g: offPer100g,
    perServingCalories: offExtraction.perServingCalories,
    labelGrams: parseServingGrams(offProduct?.serving_size || ""),
    energyKj: offExtraction.energyKj,
  });

  // ── Step 2b: If OFF has no product, try USDA branded food by UPC ─
  // Some products exist in USDA but not OFF (branded/US-market items).
  let usdaUnavailable = false;
  let usdaByUPC: {
    product: NutritionData;
    brandName?: string;
    labelServingSize?: string;
  } | null = null;
  if (!offProduct) {
    log.debug(
      { barcode: code },
      "barcode not in OFF — trying USDA branded food by UPC",
    );
    try {
      usdaByUPC = await lookupUSDAByUPC(code);
    } catch (err) {
      if (!(err instanceof UpstreamUnavailableError)) throw err;
      usdaUnavailable = true;
    }
    if (usdaByUPC) {
      log.debug(
        {
          barcode: code,
          product: usdaByUPC.product.name,
          calories: usdaByUPC.product.calories,
        },
        "USDA UPC match found",
      );
    }
  }

  // ── Step 3: Cross-reference with CNF (Canadian) + USDA ───────────
  const { secondaryPer100g, secondarySource } = await findSecondaryPer100g(
    code,
    searchTermCandidates,
    usdaSearchTerm,
  );

  // ── Step 4: Pick the best per-100g values ────────────────────────
  let per100g: BarcodePer100g;
  let source: string;
  let resolvedProductName = productName;
  let resolvedBrandName = brandName;

  // If OFF had no product but USDA found it by UPC, use the USDA-by-UPC data
  // directly as authoritative — it is NOT cross-validated. The CNF/USDA
  // secondary search terms (`secondaryPer100g`) are derived solely from the
  // OFF product (product_name_en, categories, generic_name, …); with no OFF
  // product those terms are all empty, so `secondaryPer100g` is structurally
  // always null in this path and there is nothing to reconcile against.
  // (OFF primaries, in the else branch, do cross-validate via reconcilePer100g.)
  if (!offProduct && usdaByUPC) {
    // INVARIANT: `secondaryPer100g` MUST be null here. The CNF/USDA secondary
    // search terms are derived solely from the (absent) OFF product, so with no
    // OFF product `searchTermCandidates` is empty, `usdaSearchTerm` is "", and
    // both Step-3 secondary lookups are skipped — leaving `secondaryPer100g`
    // structurally null. USDA-by-UPC data therefore passes through as
    // authoritative with no cross-validation. If a future refactor ever seeds a
    // secondary source into this path, that contract is broken: this guard fails
    // loudly (throw in non-prod so CI/tests catch the regression; log in prod so
    // we never throw on a legitimate live lookup). It does NOT alter behaviour —
    // USDA values still pass through unchanged whether or not it fires.
    if (secondaryPer100g !== null) {
      const message =
        "INVARIANT VIOLATION: secondaryPer100g is non-null in the USDA-by-UPC " +
        "authoritative path — USDA-by-UPC data is treated as authoritative with " +
        "no cross-validation. Review the Step-3 secondary lookup and reconciliation " +
        "semantics before relying on this path.";
      if (process.env.NODE_ENV !== "production") {
        throw new Error(message);
      }
      log.error({ secondarySource, secondaryPer100g }, message);
    }
    resolvedProductName = usdaByUPC.product.name;
    resolvedBrandName = usdaByUPC.brandName || undefined;
    // This sets the PRIMARY, so a null basis cannot fall back to a default.
    // `mapUsdaFoodToNutrition` hardcodes `servingSize: "100g"`, so null is
    // unreachable today; if a future mapper stops hardcoding it, degrade to an
    // empty per-100g set. Step 5's no-data check below then returns the
    // product identified but without nutrition, which is honest — unlike
    // numbers scaled from a basis we invented. Deliberately not the throwing
    // INVARIANT guard above: that defends a code contract, whereas this is
    // upstream data we must not crash a live lookup over.
    // CAVEAT if that hardcode ever changes: this path still reaches
    // `insertBarcodeNutritionIfAbsent` below, which is first-write-wins — so a
    // dropped basis persists an all-null nutrition row for the barcode that a
    // later, normalizable scan will NOT repair. Prefer returning null here over
    // widening the drop, or the Public API product DB accumulates dead rows.
    const usdaPer100g = normalizeToPerHundredGrams(usdaByUPC.product);
    if (!usdaPer100g) {
      log.warn(
        {
          servingSize: usdaByUPC.product.servingSize,
        },
        "USDA-by-UPC nutrition dropped — serving size has no gram basis",
      );
    }
    per100g = usdaPer100g ?? {};
    source = "usda";
    // USDA's own label serving size (from its `servingSize`/`servingSizeUnit`
    // fields, in a unit we can convert) — when present, this is real
    // per-serving data, not the per-100g default. Overrides the empty
    // `rawServing` from the (absent) OFF product so Step 5 below scales and
    // labels the result from it, same as an OFF `serving_size` would.
    if (usdaByUPC.labelServingSize) {
      rawServing = usdaByUPC.labelServingSize;
    }
  } else {
    // preferSecondaryOnDiscrepancy: a self-consistent OFF label (see Step 2)
    // is authoritative — the name-matched secondary may only gap-fill.
    ({ per100g, source } = reconcilePer100g(
      offPer100g,
      secondaryPer100g,
      secondarySource,
      "openfoodfacts",
      !offSelfConsistent,
      code,
    ));
  }

  // If no data from any source, give up
  if (per100g.calories === undefined && !resolvedProductName) {
    // Distinguish "every source errored" from "no source had data": only the
    // former is an outage the user can retry.
    if (!offProduct && !offAnswered && usdaUnavailable) {
      throw new UpstreamUnavailableError();
    }
    return null;
  }

  // ── Step 5: Determine serving size ───────────────────────────────
  const {
    finalGrams,
    wasCorrected,
    correctionReason,
    hasServingData,
    perServing,
  } = resolveServing(rawServing, per100g, resolvedProductName);

  // Populate barcodeNutrition table for Public API (fire-and-forget).
  // First-write-wins: existing rows are not overwritten by newer scans.
  // `servingSize` must track `finalGrams` (what `perServing` was actually
  // scaled to), not the original `rawServing`, whenever the serving was
  // corrected — `rawServing` still holds the pre-correction, implausible
  // value (e.g. "236g" for a whole box), and pairing that stale label with
  // the CORRECTED macro values (scaled to ~15g) would write a row that
  // understates calories by ~15x relative to what its own label claims. No
  // "~"/"(estimated)" cosmetic wrapper here (unlike `servingInfo.displayLabel`
  // below) — this value may be parsed as a number by other consumers.
  // Skipped when OFF carried implausible values: the row is first-write-wins,
  // so persisting it would freeze a known-bad entry past any later OFF fix.
  if (offDroppedFields.length === 0) {
    storage
      .insertBarcodeNutritionIfAbsent({
        barcode: code,
        productName: resolvedProductName || null,
        brandName: resolvedBrandName || null,
        servingSize: wasCorrected
          ? `${finalGrams}g`
          : rawServing || `${finalGrams}g`,
        calories: perServing.calories?.toFixed(2) ?? null,
        protein: perServing.protein?.toFixed(2) ?? null,
        carbs: perServing.carbs?.toFixed(2) ?? null,
        fat: perServing.fat?.toFixed(2) ?? null,
        source,
      })
      .catch((err) => {
        log.error({ err: toError(err) }, "failed to insert barcodeNutrition");
      });
  }

  return {
    productName: resolvedProductName || "Unknown Product",
    brandName: resolvedBrandName,
    imageUrl,
    barcode: code,
    per100g,
    perServing,
    servingInfo: {
      displayLabel: wasCorrected
        ? `~${finalGrams}g (estimated)`
        : rawServing || `${finalGrams}g`,
      grams: finalGrams,
      wasCorrected,
      correctionReason,
    },
    isServingDataTrusted: hasServingData && !wasCorrected,
    source,
    ingredientsText: offAllergenData.ingredientsText,
    allergenTags: offAllergenData.allergenTags,
    allergenDataAvailable: offAllergenData.allergenDataAvailable,
    ...offUniversalData,
  };
}
