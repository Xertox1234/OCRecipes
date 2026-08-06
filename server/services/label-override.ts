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

export type ConflictField = "calories" | "sugar" | "fat" | "saturatedFat";

/**
 * One field's label-vs-DB comparison inputs, plus the two policies that are
 * NOT uniform across fields.
 *
 * A single list of these, never two parallel ones. `fields` and
 * `comparedCount` are derived from the same rows precisely because
 * `saturatedFat` now feeds one and not the other: encoding that divergence as
 * a PROPERTY of the row keeps it impossible for the two to drift when a fifth
 * field is added. (Every recent defect in this area was a pair of
 * field-parallel structures updated on one path and not the other.)
 */
interface FieldComparison {
  field: ConflictField;
  /** The label's reading, already normalized to per-100. */
  labelVal: number | undefined;
  /** The record's per-100 counterpart. */
  dbVal: number | undefined;
  /**
   * Absolute per-100 gap that the label's own PRINTED ROUNDING can account
   * for. A field is only called a disagreement when the relative check fails
   * AND the gap exceeds this. `0` = no cushion, the historical behaviour.
   */
  roundingFloor: number;
  /**
   * Whether AGREEMENT on this field counts toward `comparedCount`, i.e. the
   * `compared >= 2` one-tap-log gate. Disagreement always reaches `fields`
   * regardless — raising a conflict and vouching for the screen are separate
   * outcomes.
   */
  corroborates: boolean;
}

export interface LabelConflict {
  conflict: boolean;
  fields: ConflictField[];
  labelResult?: BarcodeLookupResult;
  /**
   * Whether the label was actually compared against the record.
   *
   * On the AGREEMENT path this requires at least TWO CORROBORATING fields
   * (calories/sugar/fat — `saturatedFat` is compared but deliberately does not
   * count; see the `corroborates` flag and the comment above `cmp`) to have had
   * both a label reading and a DB per-100g counterpart. `compared` drives the
   * client's `labelUsed`, which opens one-tap logging on the claim that the
   * values on screen were checked against the package — and a calories-only
   * label makes exactly one field comparable, so a single agreement would verify
   * one number while the user logs sugar, fat, protein and sodium that were
   * never checked. On the CONFLICT path one field is enough, because the label's
   * values replace the ones they disagree with.
   *
   * `conflict: false` alone cannot tell agreement from refusal: this function
   * declines on an unparseable serving, an implausible serving, or a record with
   * no comparable field, and every one of those returns the same empty shape.
   * The client stakes its log gate on this, so the two must stay distinguishable
   * — `false` means "we did not check", NOT "we checked and it was fine".
   */
  compared: boolean;
}

/** Relative-difference threshold (25%) for calling a label-vs-DB macro a
 *  material conflict. Comparison itself reuses the codebase's single nutrition
 *  agreement policy (`valuesMatch`), which also applies the shared near-zero
 *  absolute floor — so label-override and verification/OFF-consistency can't
 *  drift into two different notions of "these numbers agree". */
const REL_THRESHOLD = 0.25;

/**
 * The increment a Nutrition Facts panel PRINTS saturated fat in: FDA
 * 21 CFR 101.9(c)(2) and CFIA's equivalent rounding table quantize it to the
 * nearest 0.5 g between 0.5 g and 5 g (to 0 below 0.5 g; to the nearest 1 g
 * above 5 g). This is a property of the labelling rules, not a tolerance tuned
 * to any observed product or test. (Cited at section level deliberately — the
 * paragraph numbering was not verified against the current CFR text, and the
 * derivation below does not depend on it.)
 *
 * It becomes an absolute floor on the saturatedFat comparison because label
 * readings are PER SERVING and get multiplied by `factor = 100 / labelGrams`
 * to reach the per-100 basis the record uses — which multiplies the printed
 * value's quantization error right along with them. On a 30 g serving
 * (`factor` 3.33) one 0.5 g printing step is ~1.7 g at per-100 scale, while
 * `valuesMatch`'s 25% relative branch allows only 1.0 g at 4 g/100g. So in the
 * 2-5 g/100g band, rounding ALONE clears the tolerance and an unguarded
 * comparison would flag two agreeing numbers as a conflict. (Below 2 g on both
 * sides `valuesMatch`'s ±1 absolute floor already applies and is more
 * forgiving; above ~5 g the relative branch comfortably exceeds the
 * quantization.) A spurious conflict is expensive here: ANY conflict takes the
 * blank-uncorrected-siblings path below, discarding the record's
 * carbs/protein/fiber/sodium.
 *
 * Why one whole step rather than the half-step either value can be off by:
 * both sides of the comparison are rounded, and their errors can point in
 * opposite directions. The label side contributes at most half a step scaled,
 * `0.25 * factor`. The record's per-100 figure is itself transcribed from a
 * panel: 0.25 g flat when that panel printed per-100 (the EU shape), up to
 * `0.25 * factor` when it printed per-serving at a comparable serving. The sum
 * is at most `0.25 * (factor + 1)`, which for `factor >= 1` — every serving
 * under 100 g, i.e. the whole band where this floor is ever the binding
 * constraint — is at most `0.5 * factor`: exactly ONE printed step scaled to
 * per-100. For servings above 100 g the expression is looser than the worst
 * case, and the relative branch dominates there anyway.
 *
 * The >5 g/serving rule (1 g steps) needs no separate term: a per-serving
 * reading above 5 g is above `5 * factor` per-100, where 25% relative already
 * allows `1.25 * factor` — more than either step's floor.
 *
 * The floor can only ever SUPPRESS a conflict, so its failure mode is falling
 * back to the database result — the direction the spec already calls safe ("on
 * doubt, fail toward the DB result"). On a very small serving it makes the
 * check nearly vacuous (a 5 g serving yields a 10 g/100g floor); accepted,
 * because at that scale the printed digit genuinely carries no finer
 * information, and the behaviour it degrades to is the no-check-at-all this
 * change replaces.
 */
const SATURATED_FAT_LABEL_ROUNDING_STEP_G = 0.5;

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
  //
  // ALL FOUR payload fields are compared, `saturatedFat` included. An earlier
  // revision of this branch excluded it and argued the exclusion was
  // deliberate; that decision was overridden (user, 2026-08-06). Writing a
  // photographed number over a database record — and into someone's food log —
  // without ever checking it against that record is the defect. The old
  // argument (the server can't tell a confident direct read from a
  // `gluedUnitIsForced` containment inference or a plain digit misread, since
  // `labelNutritionSchema` sends a bare nullable number) is a reason to trust
  // the reading LESS, which is an argument FOR corroborating it, not for
  // skipping the check.
  //
  // Two policies make the addition safe, and both live on the rows below
  // rather than in a second list:
  //
  // 1. `roundingFloor` — saturatedFat gets a quantization cushion the other
  //    three do not; the derivation is on
  //    `SATURATED_FAT_LABEL_ROUNDING_STEP_G` above. Without it the 2-5 g/100g
  //    band fires conflicts on rounding alone, and a conflict is expensive:
  //    it takes the blank-uncorrected-siblings path below, discarding the
  //    record's carbs/protein/fiber/sodium.
  //
  //    `fat` is printed in the same 0.5 g steps and has the same amplification
  //    in principle, and is deliberately left at `0` anyway: giving a floor to
  //    a field ALREADY in `cmp` would loosen a check that currently works (the
  //    Cherry Coke override is exactly a calories/sugar/fat disagreement),
  //    whereas bounding a newly-admitted field only limits a new source of
  //    false positives. If `fat` should have one, that is its own change with
  //    its own evidence — not a symmetry argument riding in on this one.
  //
  // 2. `corroborates` — saturatedFat can RAISE a conflict but can never help
  //    open the `compared >= 2` one-tap-log gate below. Policy (1) is exactly
  //    why: a saturatedFat AGREEMENT is materially weaker evidence than the
  //    other three, because a gap of up to a full printed step is scored as
  //    agreement by construction. The field whose agreement test was
  //    deliberately widened must not be the field that tips a trust threshold
  //    — otherwise a calories + saturatedFat label reaches 2 and tells the
  //    user the sugar, fat, protein and sodium on screen were checked against
  //    the package, on the strength of one number compared at a widened
  //    tolerance.
  //
  //    So both halves of this change move the same way: conflicts get EASIER
  //    to detect, and the trust gate does not get easier to open.
  //    `comparedCount` is byte-for-byte unaffected by adding this field — a
  //    deliberate property, since `compared` drives client UI (one-tap
  //    logging) well away from this file.
  //
  //    Two states this asymmetry creates, both pinned by tests:
  //    - saturatedFat the only comparable field and DISAGREEING -> conflict
  //      with `comparedCount === 0`, and the conflict path still returns
  //      `compared: true`. That is consistent with that path's existing
  //      rationale, not an exception to it: on a conflict the label's values
  //      replace the ones they disagree with, so what is displayed did come
  //      from the label.
  //    - saturatedFat the only comparable field and AGREEING -> `compared:
  //      false`. Nothing shown was corroborated broadly enough to claim it.
  //
  // Accepted residual, narrowed but not closed: a wrong saturatedFat still
  // rides into `mergedPer100g` when the RECORD has no `saturated-fat_100g` to
  // compare against and some other field conflicts. A comparison can only
  // bound what the record is able to answer. Nothing downstream re-checks it
  // either — `shouldReplaceWithAI` (client/screens/label-analysis-utils.ts)
  // compares only calories/fat/protein/carbs/sodium. What partially bounds it:
  // `evaluateUniversalFlags`'s FSA "high in saturated fat" flag has a safety
  // asymmetry — a wrong-LOW value suppressing a real record-sourced flag is
  // caught by the route's lost-flag diff (`nutrient-unavailable`), and
  // wrong-HIGH is the direction this codebase already treats as safe to risk.
  // See
  // docs/solutions/logic-errors/confidence-must-count-evidence-not-inferences-2026-08-05.md.
  const fields: ConflictField[] = [];
  const cmp: FieldComparison[] = [
    {
      field: "calories",
      labelVal: per100.calories,
      dbVal: dbResult.per100g.calories,
      roundingFloor: 0,
      corroborates: true,
    },
    {
      field: "sugar",
      labelVal: per100.sugar,
      dbVal: dbResult.per100g.sugar,
      roundingFloor: 0,
      corroborates: true,
    },
    {
      field: "fat",
      labelVal: per100.fat,
      dbVal: dbResult.per100g.fat,
      roundingFloor: 0,
      corroborates: true,
    },
    {
      field: "saturatedFat",
      labelVal: per100.saturatedFat,
      dbVal: dbResult.per100g.saturatedFat,
      roundingFloor: SATURATED_FAT_LABEL_ROUNDING_STEP_G * factor,
      corroborates: false,
    },
  ];
  // Count the fields we could actually compare, separately from the ones that
  // disagreed. An empty `fields` is ambiguous on its own: it means either "every
  // comparable field agreed" or "there was nothing comparable at all", and only
  // the first justifies the client trusting the displayed numbers.
  let comparedCount = 0;
  for (const c of cmp) {
    if (c.labelVal == null || c.dbVal == null) continue;
    if (c.corroborates) comparedCount++;
    if (valuesMatch(c.labelVal, c.dbVal, REL_THRESHOLD)) continue;
    // The relative check failed. Only call that a disagreement if the gap is
    // larger than the label's own printed rounding can explain.
    if (Math.abs(c.labelVal - c.dbVal) <= c.roundingFloor) continue;
    fields.push(c.field);
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
    // anything. `saturatedFat` agreement does not count toward this total even
    // though the field IS compared — see `corroborates` above.
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
  // clean product. The ROUTE is what keeps those apart: it holds both response
  // bodies, so it can diff their flags and raise `nutrient-unavailable` for
  // warnings that were actually lost. Deliberately not decided here — this
  // module has no access to the flag thresholds, and guessing from value
  // presence fires on records whose sodium is 0 or nowhere near the FSA line.
  const mergedPer100g: BarcodePer100g = {
    ...per100, // calories/sugar/fat/saturatedFat that the label actually read
    caffeine: dbResult.per100g.caffeine,
  };

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

  return { conflict: true, fields, labelResult, compared: true };
}
