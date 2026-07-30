import type { BarcodeLookupResult, BarcodePer100g } from "./barcode-lookup";
import { scaleNutrients } from "./barcode-lookup";
import { parseLabelServingGrams } from "@shared/lib/label-serving";
import { valuesMatch } from "../lib/verification-consensus";

export interface LabelNutritionInput {
  calories: number | null;
  totalSugars: number | null;
  totalFat: number | null;
  saturatedFat: number | null;
  servingSize: string | null;
}

export type ConflictField = "calories" | "sugar" | "fat";

export interface LabelConflict {
  conflict: boolean;
  fields: ConflictField[];
  labelResult?: BarcodeLookupResult;
  /**
   * Whether the label was actually compared against the record — i.e. at least
   * one field had both a label reading and a DB per-100g counterpart, and the
   * comparison ran.
   *
   * `conflict: false` alone cannot tell agreement from refusal: this function
   * declines on an unparseable serving, an implausible serving, or a record with
   * no comparable field, and every one of those returns the same empty shape.
   * The client stakes its log gate on this, so the two must stay distinguishable
   * — `false` means "we did not check", NOT "we checked and it was fine".
   */
  compared: boolean;
  /**
   * Whether `labelResult`'s macro block dropped a nutrient the record had a
   * value for — so `evaluateUniversalFlags` cannot warn about it.
   *
   * Only meaningful alongside `labelResult`. The route turns this into a
   * visible `nutrient-unavailable` flag: without it, "we blanked the values we
   * could not trust" renders identically to "this product has nothing worth
   * warning about", and a missing "High in sugar" is indistinguishable from a
   * low-sugar product.
   */
  nutrientsUnknown: boolean;
}

/** Relative-difference threshold (25%) for calling a label-vs-DB macro a
 *  material conflict. Comparison itself reuses the codebase's single nutrition
 *  agreement policy (`valuesMatch`), which also applies the shared near-zero
 *  absolute floor — so label-override and verification/OFF-consistency can't
 *  drift into two different notions of "these numbers agree". */
const REL_THRESHOLD = 0.25;

/** Upper plausibility bound for a label-derived serving (grams/ml). A single
 *  beverage serving tops out around a 2 L bottle; a larger value is almost
 *  certainly an OCR digit-insertion misread ("355" → "3550"). Per the spec's
 *  "on doubt, fail toward the DB result" rule we then decline to override.
 *  Deliberately more generous than barcode-lookup's 500 g bound, which targets
 *  DB per-serving sanity, not user-scanned beverage labels. */
const MAX_PLAUSIBLE_LABEL_SERVING_GRAMS = 2000;

/**
 * Compare a scanned label against the DB result and, on a material conflict,
 * build a label-corrected result. Pure — no I/O. The label is per-serving; it
 * is normalized to per-100 using the label's own parsed serving grams.
 */
export function buildLabelConflict(
  dbResult: BarcodeLookupResult,
  label: LabelNutritionInput,
): LabelConflict {
  // Every early return below is a REFUSAL to compare, so they all carry
  // `compared: false`. Only the two exits past the comparison loop can claim
  // otherwise.
  const none: LabelConflict = {
    conflict: false,
    fields: [],
    compared: false,
    // No labelResult is produced on a refusal, so nothing was blanked and the
    // record's own flags reach the user untouched.
    nutrientsUnknown: false,
  };

  // Presence gate: the label is the source of truth when present, so its
  // calories are what gets adopted — that is the only reading required here.
  // The serving check immediately below is the other half: without a parseable
  // serving there is nothing to scale by, and adopting a calorie figure would
  // silently present it as whatever serving the DB assumed.
  //
  // A sugars-or-fat reading used to be required as well. It looked like cheap
  // corroboration, but the two are not independent: the recogniser's `g` -> `9`
  // substitution breaks the sugars and fat patterns *together*, so a single
  // glitch took out both. Device-observed on a Cherry Coke can (06772408),
  // 2026-07-30 — `Calories 140` and `Per 1 can (355 mL)` read perfectly while
  // `Sugars Sucres 39 9` and `Fat / Ipldes 0 9` both failed; the label was
  // discarded and the screen showed the database's per-100 ml value, 39 kcal
  // for a 140 kcal can.
  //
  // Mirrors `isLabelReady` in client/lib/nutrition-ocr-parser.ts. The two gates
  // must agree: if the client sends a label this refuses, the refusal returns
  // the same body shape as agreement and the user sees database values with no
  // indication the label was dropped.
  if (label.calories == null) return none;

  // Comparable only if the label serving parses to grams/ml.
  //
  // Shares `parseLabelServingGrams` with the client's `isLabelReady` rather
  // than using barcode-lookup's parser, which the client had no access to.
  // The two gates previously ran different implementations that disagreed on
  // real inputs — `"355"` (an OCR line break splitting "355 mL") parsed here
  // as null but passed the client gate, so the label was POSTed, refused, and
  // the user saw database values with nothing saying the label was dropped.
  const labelGrams = parseLabelServingGrams(label.servingSize);
  if (
    labelGrams == null ||
    labelGrams <= 0 ||
    labelGrams > MAX_PLAUSIBLE_LABEL_SERVING_GRAMS
  )
    return none;

  // Cross-check the label's parsed serving against a TRUSTED DB serving. For the
  // same barcode the serving is a property of the product, so a >4x disagreement
  // means the label's grams were OCR-misread — which would make the per-100
  // comparison below garbage-in (a misread-large serving deflates label per-100
  // and suppresses a flag the base result already gets right). A trusted DB
  // serving already passed barcode-lookup's plausibility gate, so it's a
  // legitimate anchor. Per the spec's "on doubt, fail toward the DB result" we
  // decline to override — rejecting an untrustworthy computed comparison, NOT
  // overriding the label's nutrient readings. When the DB serving is untrusted
  // there is no anchor; the MAX_PLAUSIBLE bound above is the only backstop.
  const dbGrams = dbResult.servingInfo.grams;
  if (dbResult.isServingDataTrusted && dbGrams > 0) {
    const ratio = labelGrams / dbGrams;
    if (ratio > 4 || ratio < 0.25) return none;
  }

  const factor = 100 / labelGrams;

  // Normalize the label's per-serving reads to per-100. Keep these UNROUNDED:
  // the factor round-trips exactly (×100/labelGrams then ×labelGrams/100 = 1),
  // so `scaleNutrients` below lands the corrected per-serving back on the
  // label's exact value (150 kcal stays 150, not 149). Rounding per-100 here
  // would drift the per-serving off the label — and per-100g is never shown
  // raw (the macro grid Math.rounds at render; recalculateNutrition rounds its
  // output), so there's no ragged-float display to guard against.
  const per100: Partial<
    Record<"calories" | "sugar" | "fat" | "saturatedFat", number>
  > = {};
  if (label.calories != null) per100.calories = label.calories * factor;
  if (label.totalSugars != null) per100.sugar = label.totalSugars * factor;
  if (label.totalFat != null) per100.fat = label.totalFat * factor;
  if (label.saturatedFat != null)
    per100.saturatedFat = label.saturatedFat * factor;

  // Compare the read fields against the DB per-100.
  const fields: ConflictField[] = [];
  const cmp: [ConflictField, number | undefined, number | undefined][] = [
    ["calories", per100.calories, dbResult.per100g.calories],
    ["sugar", per100.sugar, dbResult.per100g.sugar],
    ["fat", per100.fat, dbResult.per100g.fat],
  ];
  // Count the fields we could actually compare, separately from the ones that
  // disagreed. An empty `fields` is ambiguous on its own: it means either "every
  // comparable field agreed" or "there was nothing comparable at all", and only
  // the first justifies the client trusting the displayed numbers.
  let comparedCount = 0;
  for (const [name, labelVal, dbVal] of cmp) {
    if (labelVal == null || dbVal == null) continue;
    comparedCount++;
    if (!valuesMatch(labelVal, dbVal, REL_THRESHOLD)) fields.push(name);
  }
  if (fields.length === 0) {
    // No disagreement. `compared` distinguishes a genuine agreement (the record
    // is corroborated by the package) from a record that simply had no per-100g
    // counterpart for anything the label read (nothing was verified).
    //
    // TWO fields, not one. `compared` drives the client's `labelUsed`, which
    // opens the one-tap log gate on the claim that the values ON SCREEN were
    // checked against the package. A calories-only label makes exactly one
    // field comparable, so agreement there verifies a single number while the
    // user logs sugar, fat, protein and sodium that were never checked against
    // anything.
    //
    // Note this is a genuine tightening, not merely a restoration: comparability
    // needs a DB per-100g counterpart too, so a record carrying
    // `energy-kcal_100g` but no `sugars_100g`/`fat_100g` reached
    // `comparedCount === 1` under the old presence gate as well, and was treated
    // as verified. It now costs one extra tap — the direction this codebase
    // already calls safe.
    //
    // The CONFLICT path below is deliberately unaffected: it replaces the values
    // it disagrees with, so what is displayed did come from the label.
    return {
      conflict: false,
      fields: [],
      compared: comparedCount >= 2,
      // No labelResult on this path — the record's own values and flags stand.
      nutrientsUnknown: false,
    };
  }

  // Build the label-corrected result: mark serving trusted so
  // evaluateUniversalFlags gets the per-portion path.
  //
  // Trust-the-label: the corrected macro block is EXACTLY what the label read.
  // This entry was DETECTED as materially wrong (Cherry Coke's error is uniform
  // across the whole entry), so its other macros can't be trusted and would
  // create impossible relationships (sugar > carbs, transFat > fat). Blank the
  // un-read macros rather than inheriting DB values. Keep caffeine + OFF
  // enrichment (NOVA/Nutri-Score/category tags) — caffeine is a spec-acknowledged
  // separate limitation and doesn't participate in a macro sub-relationship, and
  // the "Contains caffeine" flag is category-derived, not numeric.
  //
  // This branch is only reachable when the label MATERIALLY disagrees with the
  // record, so the record's per-100 basis is demonstrably wrong — which makes
  // its other macros the values there is most reason to distrust. Retaining
  // them would put an impossible combination on screen (on a real Cherry Coke
  // record: 140 kcal alongside ~11 g of sugar for a can that has 39, in a
  // fat-free, protein-free drink) and would still not raise the high-sugar
  // warning, since the retained value is ~3.5x too low. So they stay blanked.
  //
  // The cost of blanking is that `evaluateUniversalFlags` then sees `undefined`
  // for every nutrient and emits nothing, rendering identically to a genuinely
  // clean product. `nutrientsUnknown` below is what keeps those apart — the
  // route turns it into a visible flag rather than letting silence speak.
  const mergedPer100g: BarcodePer100g = {
    ...per100, // calories/sugar/fat/saturatedFat that the label actually read
    caffeine: dbResult.per100g.caffeine,
  };

  // True when the corrected block dropped a nutrient the record had a value
  // for, so the universal-flag recompute cannot warn about it. Sodium counts
  // unconditionally: `LabelNutritionInput` has no sodium field, so a record's
  // sodium warning always disappears on this path.
  const nutrientsUnknown =
    (dbResult.per100g.sugar != null && per100.sugar == null) ||
    (dbResult.per100g.saturatedFat != null && per100.saturatedFat == null) ||
    dbResult.per100g.sodium != null;
  const labelResult: BarcodeLookupResult = {
    ...dbResult,
    per100g: mergedPer100g,
    perServing: scaleNutrients(mergedPer100g, labelGrams / 100),
    servingInfo: {
      displayLabel: label.servingSize ?? `${labelGrams}g`,
      grams: labelGrams,
      wasCorrected: false,
    },
    isServingDataTrusted: true,
    source: `${dbResult.source}+label`,
  };

  return {
    conflict: true,
    fields,
    labelResult,
    compared: true,
    nutrientsUnknown,
  };
}
