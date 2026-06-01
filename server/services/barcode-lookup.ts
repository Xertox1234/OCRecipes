import { storage } from "../storage";
import { createServiceLogger, toError } from "../lib/logger";
import { roundToOneDecimal } from "../lib/math";
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
 *  - Otherwise keep the primary unchanged with the `primaryLabel` source.
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

  return { per100g: primary, source: primaryLabel };
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
  // Validate nutriments at the boundary: drop non-numeric/garbage values rather
  // than writing them to the monetized cache (under-report is the safe direction).
  const nm = offNutrimentsSchema.parse(offProduct?.nutriments ?? {});
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
        ? roundToOneDecimal(nm.sodium_100g * 1000)
        : undefined,
  };

  // ── Step 2b: If OFF has no product, try USDA branded food by UPC ─
  // Some products exist in USDA but not OFF (branded/US-market items).
  let usdaByUPC: { product: NutritionData; brandName?: string } | null = null;
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
  } else {
    ({ per100g, source } = reconcilePer100g(
      offPer100g,
      secondaryPer100g,
      secondarySource,
      "openfoodfacts",
      true,
      code,
    ));
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

  // Populate barcodeNutrition table for Public API (fire-and-forget).
  // First-write-wins: existing rows are not overwritten by newer scans.
  storage
    .insertBarcodeNutritionIfAbsent({
      barcode: code,
      productName: resolvedProductName || null,
      brandName: resolvedBrandName || null,
      servingSize: rawServing || `${finalGrams}g`,
      calories: per100g.calories?.toFixed(2) ?? null,
      protein: per100g.protein?.toFixed(2) ?? null,
      carbs: per100g.carbs?.toFixed(2) ?? null,
      fat: per100g.fat?.toFixed(2) ?? null,
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
