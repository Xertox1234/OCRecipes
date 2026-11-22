// Pure, network-free steps of `lookupBarcode` (barcode-lookup.ts). Extracted so
// each rule lives next to the code that enforces it and can be unit-tested
// without mocking fetches. Behaviour-preserving move — see
// todos/archive/P2-2026-11-19-barcode-lookup-pure-steps.md.

import { roundToOneDecimal } from "../lib/math";
import { valuesMatch } from "../lib/verification-consensus";
import {
  type BarcodePer100g,
  boundOffPer100g,
  offEnergyKcal,
  offMacrosCorroborateEnergy,
  ZERO_CAL_MAX_MACRO_KCAL_100G,
} from "./barcode-policy";
import { offNutrimentsSchema } from "./nutrition-lookup";

// FDA/Codex nearest-5-kcal label rounding can push a genuinely correct
// low-calorie label (spices, condiments) past the 15% relative tolerance in
// the offSelfConsistent ratio check — this absolute floor, OR'd alongside
// the relative check, rescues that band. ~5 kcal stays inert above
// ~33 kcal/serving, where 15% relative already exceeds it.
const ABSOLUTE_TOLERANCE_FLOOR_KCAL = 5;

/**
 * Build search terms for cross-validation (CNF + USDA).
 * OFF products often have French/local names (e.g. "Sucre") that pure-English
 * databases can't match. We collect MULTIPLE terms to try:
 *   1. product_name_en  — explicit English name
 *   2. generic_name_en  — generic English name (e.g. "Granulated sugar")
 *   3. ALL English categories — from categories_tags, most specific first
 *      (e.g. "granulated sugars", "white sugars", "sugars", "sweeteners")
 *   4. generic_name     — often in English even for non-English products
 *   5. product_name     — last resort, may be in any language
 * Returns [] when there is no OFF product.
 */
export function buildSearchTermCandidates(
  offProduct: Record<string, any> | null,
): string[] {
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
  const productName: string = offProduct?.product_name || "";
  if (productName) {
    searchTermCandidates.push(productName);
  }
  return searchTermCandidates;
}

export interface OffPer100gExtraction {
  /** Plausibility-bounded per-100g values. */
  per100g: BarcodePer100g;
  /** Fields `boundOffPer100g` dropped as implausible. */
  dropped: string[];
  /** OFF's own per-serving energy (kcal), a self-consistency signal only. */
  perServingCalories: number | undefined;
  /** Raw kJ energy fields — the zero-agreement check must not contradict them. */
  energyKj: { per100g: number | undefined; perServing: number | undefined };
}

/**
 * Step 2: extract OFF per-100g values. Validates nutriments at the boundary:
 * drops non-numeric/garbage values rather than writing them to the monetized
 * cache (under-report is the safe direction).
 */
export function extractOffPer100g(
  offProduct: Record<string, any> | null,
): OffPer100gExtraction {
  const nm = offNutrimentsSchema.parse(offProduct?.nutriments ?? {});
  const offPer100gRaw: BarcodePer100g = {
    calories: offEnergyKcal(nm["energy-kcal_100g"], nm.energy_100g),
    protein: nm.proteins_100g,
    carbs: nm.carbohydrates_100g,
    fat: nm.fat_100g,
    fiber: nm.fiber_100g,
    sugar: nm.sugars_100g,
    sodium:
      nm.sodium_100g !== undefined
        ? roundToOneDecimal(nm.sodium_100g * 1000)
        : undefined,
    saturatedFat: nm["saturated-fat_100g"],
    transFat: nm["trans-fat_100g"],
    cholesterol:
      nm.cholesterol_100g !== undefined
        ? nm.cholesterol_unit === "mg"
          ? nm.cholesterol_100g // rare: already in mg
          : roundToOneDecimal(nm.cholesterol_100g * 1000) // OFF default cholesterol unit is g → mg
        : undefined,
    caffeine:
      nm.caffeine_100g !== undefined
        ? nm.caffeine_unit === "mg"
          ? nm.caffeine_100g // rare: already in mg
          : roundToOneDecimal(nm.caffeine_100g * 1000) // OFF default caffeine unit is g → mg
        : undefined,
  };
  // Plausibility-bound the per-100g values (R34): offNumericField accepts any
  // finite number, so a typo'd OFF entry (kJ in the kcal field, protein 450 g)
  // would otherwise be shown to the user and frozen into the first-write-wins
  // barcodeNutrition cache. Dropped fields fall through to the secondary
  // source as "missing" — under-report is the safe direction.
  const { per100g, dropped } = boundOffPer100g(offPer100gRaw);

  // OFF's own per-serving energy, used only as a self-consistency signal.
  const perServingCalories = offEnergyKcal(
    nm["energy-kcal_serving"],
    nm.energy_serving,
  );
  return {
    per100g,
    dropped,
    perServingCalories,
    energyKj: { per100g: nm.energy_100g, perServing: nm.energy_serving },
  };
}

export interface OffSelfConsistencyInput {
  per100g: BarcodePer100g;
  perServingCalories: number | undefined;
  /** Grams parsed from OFF's `serving_size`, or null when unparseable. */
  labelGrams: number | null;
  energyKj: OffPer100gExtraction["energyKj"];
}

/**
 * When OFF's per-serving, per-100g, and serving-size values corroborate each
 * other (per100g × grams/100 ≈ perServing within 15%), the entry is
 * near-certainly transcribed from the real package label — three
 * independently-entered fields agreeing by accident is unlikely. The CNF/USDA
 * cross-validation is a NAME match that can land on a different food
 * entirely (a "cheese snack" category search matching a ~109 kcal/100g
 * generic against 344 kcal/100g cheese sticks — barcode 0778918011332), so a
 * self-consistent label must demote the secondary to gap-fill only, never
 * replacement. Entries missing per-serving energy (most of OFF) fall back
 * to an Atwater energy-vs-own-macros corroboration instead (see
 * `offMacrosCorroborateEnergy` / P2-2026-07-22) — self-agreement can still
 * be checked without a per-serving field, just via a looser signal.
 */
export function isOffSelfConsistent(input: OffSelfConsistencyInput): boolean {
  const {
    per100g: offPer100g,
    perServingCalories: offPerServingCal,
    labelGrams: offLabelGrams,
    energyKj,
  } = input;
  if (offPer100g.calories === undefined) return false;
  // No per-serving energy to corroborate per-100g against (most of OFF) —
  // fall back to the entry's own macros (Atwater). An identity-matched
  // (barcode) OFF entry whose energy agrees with its own macros is
  // self-consistent and must not be overwritten by a name/similarity-
  // matched secondary source (Nutella 3017620422003 regression,
  // P2-2026-07-22).
  if (offPerServingCal === undefined) {
    return offMacrosCorroborateEnergy(offPer100g);
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
    // Round kJ→kcal the same way the calories derivation does — a
    // trace kJ residual (2 kJ ≈ 0.48 kcal on some OFF water entries) rounds
    // to 0 there and must not count as a contradiction here.
    const kjContradicts =
      Math.round((energyKj.per100g ?? 0) / 4.1868) > 0 ||
      Math.round((energyKj.perServing ?? 0) / 4.1868) > 0;
    return macroKcalPer100g <= ZERO_CAL_MAX_MACRO_KCAL_100G && !kjContradicts;
  }
  if (offPerServingCal <= 0 || offPer100g.calories <= 0) {
    return false;
  }
  // Per-serving energy is usable, but the serving size carries no parseable
  // grams ("1 bottle", a fl-oz-only US label) so the ratio check below cannot
  // run. That is a MISSING signal, not a detected contradiction — fall back to
  // the same Atwater corroboration the no-per-serving-energy case uses rather
  // than declaring the entry unshielded and handing it to a name-matched
  // secondary (todo P3-2026-07-24). Cases where grams DO parse are untouched:
  // the per-serving × grams check stays authoritative there, including when
  // it disagrees.
  if (offLabelGrams === null || offLabelGrams <= 0) {
    return offMacrosCorroborateEnergy(offPer100g);
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
}
