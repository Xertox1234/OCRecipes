import type { BarcodeLookupResult, BarcodePer100g } from "./barcode-lookup";
import { scaleNutrients } from "./barcode-lookup";
import {
  parseLabelServingGrams,
  parseServingBasis,
} from "@shared/lib/label-serving";
import { FSA_DRINK, FSA_FOOD } from "@shared/constants/nutrition-bands";
import { valuesMatch } from "../lib/verification-consensus";

/**
 * A payload field whose OCR PROVENANCE can gate its comparison. Named in the
 * PAYLOAD's vocabulary (`totalSugars`, `totalFat`), not `ConflictField`'s
 * (`sugar`, `fat`), because it is the wire contract with the parser — the two
 * vocabularies are bridged by the `requiresDirectRead` property on each `cmp`
 * row, so nothing has to keep a second name map in step.
 *
 * The union is the extension point: to gate another field, set
 * `requiresDirectRead` on its row. Only `saturatedFat` is gated today.
 * `totalFat` and `totalSugars` are listed because the parser's
 * `gluedUnitIsForced` rule can reconstruct those two as well, making them the
 * plausible next candidates — NOT because anything reads them yet.
 */
export type LabelProvenanceField =
  | "calories"
  | "totalSugars"
  | "totalFat"
  | "saturatedFat";

export interface LabelNutritionInput {
  calories: number | null;
  totalSugars: number | null;
  totalFat: number | null;
  saturatedFat: number | null;
  servingSize: string | null;
  /**
   * The label fields the client's OCR parser read DIRECTLY off a glyph run,
   * rather than reconstructing via its `gluedUnitIsForced` containment rule
   * (`client/lib/nutrition-ocr-parser.ts`). See `requiresDirectRead` below for
   * what consumes it.
   *
   * OPTIONAL, and typed as loose strings, both deliberately — see the route's
   * `labelNutritionSchema`. The rule this file has to hold up: an absent or
   * unrecognised entry means "NOT a direct read". There is no encoding of this
   * field that can assert the opposite by staying silent.
   */
  directReads?: readonly string[];
}

export type ConflictField = "calories" | "sugar" | "fat" | "saturatedFat";

/**
 * One field's label-vs-DB comparison inputs, plus the three policies that are
 * NOT uniform across fields.
 *
 * A single list of these, never two parallel ones. `fields`, `comparedCount`
 * and the blanking decision are all derived from the same rows precisely
 * because `saturatedFat` feeds them differently: encoding each divergence as a
 * PROPERTY of the row keeps them impossible to drift apart when a fifth field
 * is added. (Every recent defect in this area was a pair of field-parallel
 * structures updated on one path and not the other.)
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
   *
   * It carries a SECOND meaning, used by the blanking decision below: only a
   * corroborating field's disagreement is evidence that the record's whole
   * per-100 BASIS is wrong. Deliberately one flag and not two — the two
   * questions have the same answer for the same reason. A field whose
   * agreement is too weak to vouch for the screen (because its test was
   * widened) is equally too narrow to condemn four macros it never touched.
   * If a future field ever needs to answer them differently, that is the
   * moment to split this into two properties, not before.
   */
  corroborates: boolean;
  /**
   * Payload field whose DIRECT-READ provenance this comparison requires, or
   * `null` to compare regardless of provenance.
   *
   * `null` for calories/sugar/fat, and that is not an oversight: those three
   * have been compared since before the provenance channel existed, and every
   * already-installed client sends no provenance at all. Gating them would
   * silently switch the entire installed base back to never checking a label
   * against the record — the defect this module exists to prevent.
   */
  requiresDirectRead: LabelProvenanceField | null;
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
   * KNOWN RESIDUAL, and it is new. That conflict-path rationale assumed the
   * whole displayed macro block came from the label, which was true while a
   * conflict always blanked the record's un-read macros. It no longer is: a
   * conflict raised only by non-corroborating fields keeps the record's carbs,
   * protein and sodium (see `basisDisproven` below), so `compared: true` can
   * now open one-tap logging over values that came from the database and were
   * never checked against the package. Left as-is deliberately — narrowing
   * `compared` here would also shut the gate on the saturatedFat-only shape the
   * tests pin, and the values in question are the record's own, not a label's
   * unverified reading. Revisit if a second non-corroborating field lands.
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
 * The increment a Nutrition Facts panel PRINTS saturated fat in: 0.5 g steps
 * between 0.5 g and 5 g. This is a property of the labelling rules, not a
 * tolerance tuned to any observed product or test.
 *
 * Both regimes this app's products come from agree on that step, and both
 * citations were checked against the primary text on 2026-08-06:
 *
 * - US — 21 CFR 101.9(c)(2)(i): saturated fat "expressed as grams per serving
 *   to the nearest 0.5 gram (1/2) gram increment below 5 grams and to the
 *   nearest gram increment above 5 grams. If the serving contains less than
 *   0.5 gram, the content shall be expressed as zero."
 * - Canada — the table to section B.01.401 of the Food and Drug Regulations,
 *   as published in CFIA's industry labelling tool: 0.5 g to 5 g -> nearest
 *   0.5 g; more than 5 g -> nearest 1 g.
 *
 * They DIVERGE below 0.5 g, and the previous version of this comment asserted
 * the US rule for both: Canada rounds a sub-0.5 g figure to the nearest 0.1 g
 * rather than to zero. It does not touch the derivation. The floor is built
 * from the 0.5-5 g step, which is common to both, and below 0.5 g per serving
 * the two sides land under 2 g/100g at any factor this floor is binding for,
 * where `valuesMatch`'s own ±1 absolute branch is already the wider tolerance.
 *
 * Corroborated inside this repo by two independent write-ups of the same grid:
 * the `PARENT_FIELD` docblock in `client/lib/nutrition-ocr-parser.ts` and
 * `docs/solutions/logic-errors/regime-dependent-invariant-breaks-on-mixed-provenance-data-2026-08-05.md`.
 * (Both state the 0.5 g / 1 g grid only, so neither is affected by the sub-0.5 g
 * correction above.)
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
 * back to the database result — the direction the spec generally calls safe
 * ("on doubt, fail toward the DB result"). But `step * factor` has no upper
 * bound and `parseLabelServingGrams` enforces no minimum serving, so on a small
 * enough serving that failure mode stops being conservative and becomes total:
 * a 5 g serving yields `factor` 20 and a 10 g/100g floor, wider than the ENTIRE
 * saturated-fat MEDIUM band on either FSA scale. At that point the comparison
 * cannot see a label crossing the high-saturated-fat line at all — and 5-30 g
 * servings (butter, oils, spreads, cheese) are exactly where saturated fat is
 * the nutrient that matters. So the floor is CLAMPED; see
 * `saturatedFatFloorCeiling`.
 */
const SATURATED_FAT_LABEL_ROUNDING_STEP_G = 0.5;

/**
 * Upper bound on the saturatedFat `roundingFloor`, derived from the FSA band
 * this app already judges the nutrient against rather than picked.
 *
 * The floor's job is to forgive printing rounding. The thing it must never be
 * able to forgive is a genuine LOW-to-HIGH move, because that is the whole
 * signal the comparison exists to catch. So bound it at HALF the width of the
 * MEDIUM band — the open interval between `low` and `high` in
 * `shared/constants/nutrition-bands.ts` — which leaves it unable to carry a
 * value even halfway across the span between the two boundaries:
 *
 *   FSA_FOOD.saturatedFat   1.5 -> 5.0    width 3.5     ceiling 1.75
 *   FSA_DRINK.saturatedFat  0.75 -> 2.5   width 1.75    ceiling 0.875
 *
 * Scale-aware because the two differ by 2x and a drink judged on the food
 * ceiling would get twice the slack the FSA allows it. The unit comes from the
 * LABEL's own serving line, which is the same string the per-100 basis was
 * computed from — and `parseLabelServingGrams` only returns non-null when a
 * g/ml token matched, so by the time this runs the unit is known. An
 * unparseable basis still falls to the NARROWER (drink) ceiling: no evidence of
 * scale must not buy the more generous bound.
 *
 * CLAMP rather than decline-to-compare, which is the other shape this could
 * take (and the shape the serving-ratio cross-check above uses). Declining
 * would restore, for exactly the small-serving products where saturated fat
 * matters most, the "label overwrites the record unchecked" behaviour this
 * module was changed to end. Clamping keeps the check running and only makes it
 * STRICTER as the serving shrinks. The cost is spurious conflicts at degenerate
 * servings, and that cost is now bounded: a saturatedFat-only conflict no
 * longer blanks the record's other macros (see `basisDisproven` below), so a
 * false positive costs a conflict prompt, not four discarded nutrients.
 */
/**
 * The record's per-100 macros that may be shown ALONGSIDE the label's corrected
 * ones, on the path where nothing disproved the record's basis.
 *
 * Almost all of them can: `LabelNutritionInput` has no carbs, protein, fibre or
 * sodium field at all, so those four can only ever come from the record, and no
 * label reading contradicts them.
 *
 * `fat` is the exception, and it is the whole reason this is a function. It is
 * `saturatedFat`'s CONTAINMENT PARENT — saturated fat is a fraction of total
 * fat, under every labelling regime — and `saturatedFat` is the one field that
 * can be corrected by the label while `fat` comes from the record. That happens
 * on a genuinely ordinary panel: the parser DECLINES an ambiguous glued
 * "Total Fat 19" (it has no parent of its own to be bounded by) while reading
 * "Saturated Fat 6 g" one line below perfectly. The result would be the
 * record's 3 g of total fat displayed beside the label's 21 g/100g of saturated
 * fat.
 *
 * Checked by VALUE rather than dropped whenever the pairing occurs. The
 * distinction the route's flag-diff comment draws applies here in reverse: that
 * one refuses to infer "a warning was lost" from value presence, because the
 * proxy fires on records it shouldn't. This is not a proxy — it is the exact
 * invariant being protected, evaluated directly — so it drops precisely the
 * values that would be impossible and keeps a total fat that genuinely contains
 * the corrected figure.
 */
function retainableSiblings(
  dbPer100g: BarcodePer100g,
  per100: Partial<
    Record<"calories" | "sugar" | "fat" | "saturatedFat", number>
  >,
): BarcodePer100g {
  const retained: BarcodePer100g = { ...dbPer100g };
  // Only when the label supplied the child and NOT the parent — if it read both,
  // they are one self-consistent source and this module does not second-guess it.
  if (
    per100.saturatedFat !== undefined &&
    per100.fat === undefined &&
    retained.fat !== undefined &&
    per100.saturatedFat > retained.fat
  ) {
    delete retained.fat;
  }
  return retained;
}

function saturatedFatFloorCeiling(servingSize: string | null): number {
  const band =
    parseServingBasis(servingSize)?.unit === "g"
      ? FSA_FOOD.saturatedFat
      : FSA_DRINK.saturatedFat;
  return (band.high - band.low) / 2;
}

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
  // argument was that the server cannot tell a confident direct read from a
  // `gluedUnitIsForced` containment inference or a plain digit misread, since
  // `labelNutritionSchema` sent a bare nullable number. Half of that is a
  // reason to trust the reading LESS, which argues FOR corroborating it rather
  // than for skipping the check. The other half was a real gap in the wire
  // format, and it is now closed rather than reasoned around: the payload
  // carries provenance, and an INFERRED saturatedFat is excluded from the
  // comparison by policy (3).
  //
  // Three policies make the addition safe, and all of them live on the rows
  // below rather than in a second list:
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
  // rides into `mergedPer100g` when some other field conflicts and this one was
  // never compared — because the RECORD has no `saturated-fat_100g` to compare
  // against, or because policy (3) declined to compare an inferred reading, or
  // because the client is an older build sending no provenance at all. A
  // comparison can only bound what the record is able to answer, and a
  // comparison it is not allowed to run bounds nothing. All three are the same
  // trade in different clothes: the label stays the source of truth for what it
  // read, and the check only ever narrows what it may CONDEMN. Nothing
  // downstream re-checks it either — `shouldReplaceWithAI`
  // (client/screens/label-analysis-utils.ts) compares only
  // calories/fat/protein/carbs/sodium. What partially bounds it:
  // `evaluateUniversalFlags`'s FSA "high in saturated fat" flag has a safety
  // asymmetry — a wrong-LOW value suppressing a real record-sourced flag is
  // caught by the route's lost-flag diff (`nutrient-unavailable`), and
  // wrong-HIGH is the direction this codebase already treats as safe to risk.
  // See
  // docs/solutions/logic-errors/confidence-must-count-evidence-not-inferences-2026-08-05.md.
  //
  // 3. `requiresDirectRead` — saturatedFat is compared only when the payload
  //    positively says the parser READ it off the panel. `gluedUnitIsForced`
  //    can also reconstruct this field from its `totalFat` parent, and that
  //    inference's error is bounded by `[0, totalFat]` — orders of magnitude
  //    wider than the printed-rounding error `roundingFloor` is sized for. A
  //    wrong inference compared at a print-rounding tolerance could raise a
  //    conflict entirely on its own, and the parser comment notes this
  //    inference path "is now exercised routinely". Provenance gates the
  //    COMPARISON only: an inferred value is still accepted, still scaled into
  //    `per100`, and still adopted on the conflict and null-DB paths, because
  //    the product rule that the label is the source of truth is unchanged.
  //    What it may not do is CONDEMN the record.
  const directReads = new Set(label.directReads ?? []);
  const conflicting: FieldComparison[] = [];
  const cmp: FieldComparison[] = [
    {
      field: "calories",
      labelVal: per100.calories,
      dbVal: dbResult.per100g.calories,
      roundingFloor: 0,
      corroborates: true,
      requiresDirectRead: null,
    },
    {
      field: "sugar",
      labelVal: per100.sugar,
      dbVal: dbResult.per100g.sugar,
      roundingFloor: 0,
      corroborates: true,
      requiresDirectRead: null,
    },
    {
      field: "fat",
      labelVal: per100.fat,
      dbVal: dbResult.per100g.fat,
      roundingFloor: 0,
      corroborates: true,
      requiresDirectRead: null,
    },
    {
      field: "saturatedFat",
      labelVal: per100.saturatedFat,
      dbVal: dbResult.per100g.saturatedFat,
      roundingFloor: Math.min(
        SATURATED_FAT_LABEL_ROUNDING_STEP_G * factor,
        saturatedFatFloorCeiling(label.servingSize),
      ),
      corroborates: false,
      requiresDirectRead: "saturatedFat",
    },
  ];
  // Count the fields we could actually compare, separately from the ones that
  // disagreed. An empty `fields` is ambiguous on its own: it means either "every
  // comparable field agreed" or "there was nothing comparable at all", and only
  // the first justifies the client trusting the displayed numbers.
  let comparedCount = 0;
  for (const c of cmp) {
    if (c.labelVal == null || c.dbVal == null) continue;
    // Provenance gate. `directReads` is absent on every client that predates
    // the field, so this MUST be a positive membership test: `!has(...)` skips,
    // and there is deliberately no branch that treats silence as a direct read.
    if (c.requiresDirectRead && !directReads.has(c.requiresDirectRead))
      continue;
    if (c.corroborates) comparedCount++;
    if (valuesMatch(c.labelVal, c.dbVal, REL_THRESHOLD)) continue;
    // The relative check failed. Only call that a disagreement if the gap is
    // larger than the label's own printed rounding can explain.
    if (Math.abs(c.labelVal - c.dbVal) <= c.roundingFloor) continue;
    // Keep the ROW, not just its name: the blanking decision below needs the
    // `corroborates` flag of whatever disagreed, and re-deriving that from a
    // list of names is exactly the field-parallel lookup this file avoids.
    conflicting.push(c);
  }
  const fields = conflicting.map((c) => c.field);
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
  // ...but ONLY when something actually disproved that basis.
  //
  // Every paragraph above argues from the Cherry Coke shape, where the label
  // and the record disagree on CALORIES — an error that is uniform across the
  // entry, so the record's other macros go with it. `saturatedFat` broke that
  // assumption by joining `cmp`: a conflict can now be raised by a single
  // field that says nothing about the basis, while calories, sugar and fat all
  // AGREE. That combination is not weak evidence of a basis-wide error, it is
  // evidence AGAINST one — three independent fields on the record's per-100
  // basis just matched the package. Blanking there discarded the record's
  // carbs, protein and sodium on the strength of one disagreeing nutrient
  // (reproduced: db calories 380 / sugar 1.5 / fat 30 / satFat 2 / carbs 2 /
  // protein 24 / sodium 650, against a label agreeing on the first three ->
  // carbs, protein and sodium all `undefined`).
  //
  // So the blanking is scoped to what was actually disproved. `corroborates`
  // is the same flag that decides whether AGREEMENT vouches for the screen,
  // reused here for the mirror question — see its docblock.
  //
  // Note the two cases stay genuinely distinct rather than one subsuming the
  // other: when a corroborating field disagrees, the un-read macros are blanked
  // exactly as before, Cherry Coke included.
  const basisDisproven = conflicting.some((c) => c.corroborates);
  const mergedPer100g: BarcodePer100g = basisDisproven
    ? {
        ...per100, // calories/sugar/fat/saturatedFat that the label actually read
        caffeine: dbResult.per100g.caffeine,
      }
    : // Nothing challenged the basis, so the record's un-read macros are the
      // best (and only) figures available for them — "on doubt, fail toward the
      // DB result". `per100` still wins wherever the label read a value, so the
      // disagreeing nutrient is still corrected to the label's.
      //
      // One sibling cannot simply be retained, though, and it is the reason
      // this is a function call and not a spread. Mixing sources is exactly
      // what the old unconditional blanking prevented, and `fat` is
      // `saturatedFat`'s CONTAINMENT PARENT: keeping the record's total fat
      // beside a label-corrected saturated fat can put `saturatedFat > fat` on
      // screen — nutritionally impossible, on the screen that tells the user to
      // trust the label. See `retainableSiblings`.
      { ...retainableSiblings(dbResult.per100g, per100), ...per100 };

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
