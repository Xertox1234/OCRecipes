import { storage } from "../storage";
import { createServiceLogger, toError } from "../lib/logger";
import { roundToOneDecimal } from "../lib/math";
import { valuesMatch } from "../lib/verification-consensus";
import { mapOffAllergenTags } from "./off-allergen-tags";
import {
  lookupCNF,
  lookupNutrition,
  lookupUSDAByUPC,
  offNutrimentsSchema,
  type NutritionData,
} from "./nutrition-lookup";

const log = createServiceLogger("barcode-lookup");

// Timeout for outbound API requests (10 seconds)
const FETCH_TIMEOUT_MS = 10_000;

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
  saturatedFat?: number; // g
  transFat?: number; // g
  cholesterol?: number; // mg
  caffeine?: number; // mg
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
  // Phase 1 (Smart Scan): OFF-derived allergen data. Read live, NEVER persisted
  // to barcodeNutrition (ODbL). allergenDataAvailable === false is the
  // fail-dangerous signal for the flag evaluator. Availability means we have
  // ingredient text or an in-model allergen tag we can actually check
  // against — a tag outside our 9-allergen model doesn't count.
  ingredientsText?: string;
  allergenTags?: string[];
  allergenDataAvailable: boolean;
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

const MAX_PLAUSIBLE_SERVING_GRAMS = 500;
const MAX_PLAUSIBLE_SERVING_CALORIES = 800;
// A "0 calorie" label is only credible when the entry's own macros are also
// ~0 (Atwater: 4p + 4c + 9f per 100g). The 4 kcal/100g cutoff is a per-100g
// heuristic loosely inspired by the US "<5 kcal per serving rounds to zero"
// labeling rule — NOT equivalent to it (that rule is per serving, and a large
// serving scales 4 kcal/100g well past 5 kcal). Water/diet soda/black coffee
// pass; data-entry stubs with real macros but placeholder-zero energy don't.
const ZERO_CAL_MAX_MACRO_KCAL_100G = 4;
// FDA/Codex nearest-5-kcal label rounding can push a genuinely correct
// low-calorie label (spices, condiments) past the 15% relative tolerance in
// the offSelfConsistent ratio check — this absolute floor, OR'd alongside
// the relative check, rescues that band. ~5 kcal stays inert above
// ~33 kcal/serving, where 15% relative already exceeds it.
const ABSOLUTE_TOLERANCE_FLOOR_KCAL = 5;

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
 */
function normalizeToPerHundredGrams(data: NutritionData): BarcodePer100g {
  const grams = parseFloat(data.servingSize) || 100;
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
export function barcodeVariants(code: string): string[] {
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

/**
 * Look up a barcode via Open Food Facts, then cross-validate per-100g
 * nutrition with USDA FoodData Central (and API Ninjas as fallback).
 *
 * Returns null only when no source has data for this barcode.
 */
export async function lookupBarcode(
  code: string,
): Promise<BarcodeLookupResult | null> {
  // ── Step 1: Fetch Open Food Facts (try padding variants) ─────────
  // Open Food Facts returns deeply nested, loosely-typed product objects.
  // Using `any` here is pragmatic — a full interface would be brittle and unmaintainable.
  let offProduct: Record<string, any> | null = null;
  const codesToTry = barcodeVariants(code);

  for (const variant of codesToTry) {
    try {
      const res = await fetch(
        `https://world.openfoodfacts.org/api/v0/product/${variant}.json`,
        { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );
      const json = await res.json();
      if (json.status === 1 && json.product) {
        offProduct = json.product;
        log.debug(
          { barcode: code, variant, digits: variant.length },
          "barcode found in OFF",
        );
        break;
      }
    } catch (err) {
      log.warn({ err: toError(err), variant }, "Open Food Facts fetch error");
    }
  }

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

  // Phase 1 (Smart Scan): OFF allergen/ingredient data, read live and surfaced
  // on the result only — NEVER persisted (see barcodeNutrition insert below).
  const offAllergenData = extractOffAllergenData(offProduct);

  // ── Step 2: Extract OFF per-100g values ──────────────────────────
  // Validate nutriments at the boundary: drop non-numeric/garbage values rather
  // than writing them to the monetized cache (under-report is the safe direction).
  const nm = offNutrimentsSchema.parse(offProduct?.nutriments ?? {});
  const offPer100g: BarcodePer100g = {
    calories:
      nm["energy-kcal_100g"] ??
      (nm.energy_100g !== undefined
        ? Math.round(nm.energy_100g / 4.1868)
        : undefined),
    protein: nm.proteins_100g,
    carbs: nm.carbohydrates_100g,
    fat: nm.fat_100g,
    fiber: nm.fiber_100g,
    sugar: nm.sugars_100g,
    sodium:
      nm.sodium_100g !== undefined
        ? roundToOneDecimal(nm.sodium_100g * 1000)
        : undefined,
  };

  // OFF's own per-serving energy, used only as a self-consistency signal below.
  const offPerServingCal =
    nm["energy-kcal_serving"] ??
    (nm.energy_serving !== undefined
      ? Math.round(nm.energy_serving / 4.1868)
      : undefined);

  // When OFF's per-serving, per-100g, and serving-size values corroborate each
  // other (per100g × grams/100 ≈ perServing within 15%), the entry is
  // near-certainly transcribed from the real package label — three
  // independently-entered fields agreeing by accident is unlikely. The CNF/USDA
  // cross-validation below is a NAME match that can land on a different food
  // entirely (a "cheese snack" category search matching a ~109 kcal/100g
  // generic against 344 kcal/100g cheese sticks — barcode 0778918011332), so a
  // self-consistent label must demote the secondary to gap-fill only, never
  // replacement. Entries missing per-serving energy (most of OFF) keep the
  // existing replace-on-discrepancy behavior — self-agreement can't be checked.
  const offLabelGrams = parseServingGrams(offProduct?.serving_size || "");
  const offSelfConsistent = (() => {
    if (offPerServingCal === undefined || offPer100g.calories === undefined) {
      return false;
    }
    // Explicit-zero corroboration: BOTH energy fields present and exactly 0
    // (water, diet soda, black coffee) is agreement, not missing data —
    // without this, reconcilePer100g's primaryMissing arm (pc === 0) replaces
    // a true zero with a name-matched secondary's phantom calories (prod
    // sweep 2026-07-17: spring water cached at 257 kcal). Zero-agreement
    // needs no serving grams (0 × grams / 100 = 0 for any grams), so this
    // runs BEFORE the grams guard — but the zeros must not be contradicted
    // by the entry's own macros or kJ energy fields (placeholder-zero stubs).
    // A zero per-100g paired with a NONZERO per-serving falls through to the
    // ratio check's > 0 guards and stays unshielded (likely unfilled entry).
    if (offPerServingCal === 0 && offPer100g.calories === 0) {
      const macroKcalPer100g =
        4 * (offPer100g.protein ?? 0) +
        4 * (offPer100g.carbs ?? 0) +
        9 * (offPer100g.fat ?? 0);
      // Round kJ→kcal the same way the calories derivation above does — a
      // trace kJ residual (2 kJ ≈ 0.48 kcal on some OFF water entries) rounds
      // to 0 there and must not count as a contradiction here.
      const kjContradicts =
        Math.round((nm.energy_100g ?? 0) / 4.1868) > 0 ||
        Math.round((nm.energy_serving ?? 0) / 4.1868) > 0;
      return macroKcalPer100g <= ZERO_CAL_MAX_MACRO_KCAL_100G && !kjContradicts;
    }
    if (
      offLabelGrams === null ||
      offLabelGrams <= 0 ||
      offPerServingCal <= 0 ||
      offPer100g.calories <= 0
    ) {
      return false;
    }
    const scaledPer100g = (offPer100g.calories * offLabelGrams) / 100;
    // The relative check is delegated to `valuesMatch` — the same
    // numeric-agreement primitive `server/lib/verification-consensus.ts`
    // uses for verification consensus — so this codebase keeps ONE agreement
    // policy for nutrition data (todo P3-2026-07-17-off-self-consistency-
    // gate-refinements). `valuesMatch`'s own small-value (<2) absolute floor
    // is subsumed by the ABSOLUTE_TOLERANCE_FLOOR_KCAL check on the `||`'s
    // left side: whenever both operands are <2, their difference is <2,
    // which is always <= the 5 kcal floor, so that branch short-circuits
    // before `valuesMatch` is ever reached — this floor stays 0-vs-tiny
    // unshielded, exactly as before (the explicit 0-and-0 branch above is a
    // separate, untouched code path).
    return (
      Math.abs(scaledPer100g - offPerServingCal) <=
        ABSOLUTE_TOLERANCE_FLOOR_KCAL ||
      valuesMatch(scaledPer100g, offPerServingCal, 0.15)
    );
  })();

  // ── Step 2b: If OFF has no product, try USDA branded food by UPC ─
  // Some products exist in USDA but not OFF (branded/US-market items).
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
    usdaByUPC = await lookupUSDAByUPC(code);
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
        secondaryPer100g = normalizeToPerHundredGrams(cnfResult);
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
        secondaryPer100g = normalizeToPerHundredGrams(secondary);
        secondarySource =
          secondary.source === "cache" ? "usda" : secondary.source;
      }
    } catch (err) {
      log.warn({ err: toError(err) }, "secondary nutrition lookup failed");
    }
  }

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
      log.error({ barcode: code, secondarySource, secondaryPer100g }, message);
    }
    resolvedProductName = usdaByUPC.product.name;
    resolvedBrandName = usdaByUPC.brandName || undefined;
    per100g = normalizeToPerHundredGrams(usdaByUPC.product);
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
    return null;
  }

  // ── Step 5: Determine serving size ───────────────────────────────
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
  // Hoisted so both the storage write below and the returned result use the
  // SAME per-serving values as `servingSize` — writing `per100g` values next
  // to a real per-serving `servingSize` label (e.g. "30g") would understate
  // the true serving size's calorie mismatch by the scale factor (a 30g
  // serving at 400 kcal/100g is ~120 kcal, not 400). Previously masked in the
  // USDA-by-UPC branch only because `rawServing` was always "" there, so
  // `servingSize` always fell back to `${finalGrams}g` (100g), which happens
  // to equal the per100g denominator.
  const perServing = scaleNutrients(per100g, scale);

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
  };
}
