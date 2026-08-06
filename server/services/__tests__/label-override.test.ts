import { it, expect } from "vitest";
import {
  buildLabelConflict,
  type LabelNutritionInput,
} from "../label-override";
import type { BarcodeLookupResult } from "../barcode-lookup";
import { valuesMatch } from "../../lib/verification-consensus";

// DB result shaped like OFF's wrong Cherry Coke entry (per-100 ml).
function cherryCokeDb(): BarcodeLookupResult {
  return {
    productName: "Cherry Coke",
    barcode: "06772408",
    per100g: { calories: 11.11, sugar: 3.09, fat: 0, caffeine: undefined },
    perServing: { calories: 39, sugar: 11, fat: 0 },
    servingInfo: { displayLabel: "355 ml", grams: 355, wasCorrected: false },
    isServingDataTrusted: true,
    source: "openfoodfacts+self-consistent",
    allergenDataAvailable: true,
    novaGroup: 4,
    categoriesTags: ["en:colas", "en:beverages"],
  };
}

const goodLabel: LabelNutritionInput = {
  calories: 150,
  totalSugars: 39,
  totalFat: 0,
  saturatedFat: null,
  servingSize: "355 mL",
};

it("flags a conflict on calories AND sugar for the Cherry Coke case", () => {
  const r = buildLabelConflict(cherryCokeDb(), goodLabel);
  expect(r.conflict).toBe(true);
  expect(r.fields).toEqual(expect.arrayContaining(["calories", "sugar"]));
});

it("label result is a TRUSTED per-serving entry with servingGrams from the label", () => {
  const { labelResult } = buildLabelConflict(cherryCokeDb(), goodLabel);
  expect(labelResult).toBeDefined();
  expect(labelResult!.isServingDataTrusted).toBe(true);
  expect(labelResult!.servingInfo.grams).toBe(355);
  // Corrected per-serving is the label's EXACT reading (no round-trip drift):
  // 150 kcal stays 150, not 149.
  expect(labelResult!.perServing.calories).toBe(150);
  // per-serving sugar comes back to ~39 (label value), per-100 ml ~11
  expect(labelResult!.perServing.sugar).toBeCloseTo(39, 0);
  expect(labelResult!.per100g.sugar).toBeCloseTo(11, 0);
});

it("keeps OFF-only enrichment from the DB on the label result", () => {
  const { labelResult } = buildLabelConflict(cherryCokeDb(), goodLabel);
  expect(labelResult!.novaGroup).toBe(4);
  expect(labelResult!.categoriesTags).toEqual(["en:colas", "en:beverages"]);
});

it("no conflict when the label agrees within 25%", () => {
  const db = cherryCokeDb();
  db.per100g = { calories: 42, sugar: 11, fat: 0 };
  db.perServing = { calories: 149, sugar: 39, fat: 0 };
  expect(buildLabelConflict(db, goodLabel).conflict).toBe(false);
});

it("no conflict (not comparable) when the label serving is unparseable", () => {
  const r = buildLabelConflict(cherryCokeDb(), {
    ...goodLabel,
    servingSize: "1 bottle",
  });
  expect(r.conflict).toBe(false);
  expect(r.labelResult).toBeUndefined();
});

it("presence gate: declines when calories are unread — nothing to adopt", () => {
  const noCals = buildLabelConflict(cherryCokeDb(), {
    ...goodLabel,
    calories: null,
  });
  expect(noCals.conflict).toBe(false);
  expect(noCals.compared).toBe(false);
});

/**
 * The label is the source of truth when present: its serving size and calories
 * are adopted over the database record (user decision, 2026-07-30). So calories
 * plus a parseable serving is sufficient — a sugars-or-fat reading is NOT also
 * required.
 *
 * This is the real device shape. A Cherry Coke can (06772408) OCR'd
 * `Calories 140` and `Per 1 can (355 mL)` cleanly while every macro failed,
 * because the recogniser reads `g` as `9` (`Sugars Sucres 39 9`,
 * `Fat / Ipldes 0 9`) — one glitch takes out sugars and fat together, so
 * "either one" was never the independent corroboration it looked like. Under
 * the old gate this label was discarded and the screen showed the database's
 * per-100 ml figure: 39 kcal for a 140 kcal can.
 */
it("compares a calories-only label — the device Cherry Coke shape", () => {
  const caloriesOnly: LabelNutritionInput = {
    calories: 140,
    totalSugars: null,
    totalFat: null,
    saturatedFat: null,
    servingSize: "1 can (355 mL)",
  };
  const r = buildLabelConflict(cherryCokeDb(), caloriesOnly);

  // It must actually COMPARE — `compared` is what drives the client's
  // `labelUsed`, and a refusal here is indistinguishable from agreement.
  expect(r.compared).toBe(true);
  // 140 kcal / 355 ml = 39.4 per-100 vs the DB's 11.11 — a real conflict.
  expect(r.conflict).toBe(true);
  expect(r.fields).toContain("calories");
  // And the corrected result carries the LABEL's serving and exact calories.
  expect(r.labelResult).toBeDefined();
  expect(r.labelResult!.servingInfo.grams).toBe(355);
  expect(r.labelResult!.perServing.calories).toBe(140);
});

/**
 * Blanking the un-read macros is right when the label supplied COMPETING
 * values — that is evidence the record is mis-scaled, and inheriting its other
 * macros would create impossible relationships (sugar > carbs).
 *
 * It is wrong when the label read no macros at all. There is no evidence
 * against the record's other nutrients, and blanking them means the route's
 * `evaluateUniversalFlags` recompute sees `undefined` everywhere and emits NO
 * nutrient warnings — so "High in sugar" silently disappears at the exact
 * moment the UI tells the user to trust the label.
 */
it("blanks the un-read nutrients rather than inheriting a disproven basis", () => {
  // The UNMODIFIED fixture: a record mis-scaled on a per-355 ml basis
  // (calories 11.11, sugar 3.09 per-100). This branch is only reachable
  // BECAUSE the label's calories disagree by >25%, which is exactly what
  // proves that basis wrong — so its sugar is untrustworthy too and must not
  // be shown. Retaining it would put 140 kcal beside ~11 g of sugar for a can
  // that has 39, in a fat-free, protein-free drink.
  const r = buildLabelConflict(cherryCokeDb(), {
    calories: 140,
    totalSugars: null,
    totalFat: null,
    saturatedFat: null,
    servingSize: "1 can (355 mL)",
  });

  expect(r.labelResult).toBeDefined();
  // The label's calories win.
  expect(r.labelResult!.perServing.calories).toBe(140);
  // The record's sugar is dropped, not inherited at a basis we just disproved.
  //
  // Whether that silence gets ANNOUNCED is the route's call, not this module's:
  // it holds both response bodies and can diff their flags, so it raises
  // `nutrient-unavailable` only for a warning the record actually made and the
  // label body lost. Deciding here from value presence would fire on nearly
  // every scan, since most records carry a sodium figure — including 0 — and
  // `LabelNutritionInput` has no sodium field at all.
  expect(r.labelResult!.per100g.sugar).toBeUndefined();
  expect(r.labelResult!.per100g.sodium).toBeUndefined();
});

it("keeps the nutrients the label DID supply", () => {
  // goodLabel reads sugar and fat, so the corrected block carries real values
  // and the universal-flag recompute has something to work with.
  const db = cherryCokeDb();
  db.per100g = { calories: 11.11, sugar: 3.09, fat: 0 };
  const r = buildLabelConflict(db, goodLabel);
  expect(r.conflict).toBe(true);
  // 39 g per 355 ml = ~11 per-100, from the LABEL rather than the record.
  expect(r.labelResult!.per100g.sugar).toBeCloseTo(11, 0);
});

/**
 * `compared` drives the client's `labelUsed`, which opens the one-tap log gate
 * on the claim that the values on screen were checked against the package. With
 * a calories-only label exactly ONE field is comparable, so agreement there
 * verifies one number while the user logs sugar, fat, protein and sodium that
 * were never checked. Require two.
 *
 * The CONFLICT path is unaffected: it replaces the values it disagrees with, so
 * what is displayed really did come from the label.
 */
it("agreement on calories alone does not claim the label was verified", () => {
  const db = cherryCokeDb();
  // Make the DB agree with the label on calories (140 / 355 ml = 39.4 per-100).
  db.per100g = { calories: 39.4, sugar: 11, fat: 0 };
  const r = buildLabelConflict(db, {
    calories: 140,
    totalSugars: null,
    totalFat: null,
    saturatedFat: null,
    servingSize: "1 can (355 mL)",
  });

  expect(r.conflict).toBe(false);
  // Only one field was comparable — not enough to claim the record is verified.
  expect(r.compared).toBe(false);
});

it("agreement on two or more fields still claims verification", () => {
  const db = cherryCokeDb();
  db.per100g = { calories: 42, sugar: 11, fat: 0 };
  db.perServing = { calories: 149, sugar: 39, fat: 0 };
  const r = buildLabelConflict(db, goodLabel);
  expect(r.conflict).toBe(false);
  expect(r.compared).toBe(true);
});

it("still declines a calories-only label whose serving cannot be parsed", () => {
  // No grams/ml token: there is nothing to scale by, so adopting 140 would
  // silently present it as whatever serving the DB assumed.
  const r = buildLabelConflict(cherryCokeDb(), {
    calories: 140,
    totalSugars: null,
    totalFat: null,
    saturatedFat: null,
    servingSize: "1 can",
  });
  expect(r.compared).toBe(false);
  expect(r.conflict).toBe(false);
});

it("compares only fields the OCR read (sugar-only disagreement still conflicts)", () => {
  const label: LabelNutritionInput = {
    calories: 43,
    totalSugars: 39,
    totalFat: null,
    saturatedFat: null,
    servingSize: "355 mL",
  }; // calories agree (~11 vs 12 per-100 once 43/355mL is normalized), sugar disagrees
  const r = buildLabelConflict(cherryCokeDb(), label);
  expect(r.conflict).toBe(true);
  expect(r.fields).toEqual(["sugar"]);
});

it("no override when the label serving is implausibly large (likely OCR misread)", () => {
  // "355 mL" with an inserted digit → 3550, beyond any real single serving.
  // Per the spec's "on doubt, fail toward the DB result", decline to override.
  const r = buildLabelConflict(cherryCokeDb(), {
    ...goodLabel,
    servingSize: "3550 mL",
  });
  expect(r.conflict).toBe(false);
  expect(r.labelResult).toBeUndefined();
});

it("blanks un-read DB macros on the label result — no impossible sugar > carbs", () => {
  // The DB entry HAS a (wrong) carbs value; the label never reads carbs at
  // all (LabelNutritionInput has no carbs field — that's the whole DoD-label
  // shape: "Per 355 mL / Calories 150 / Sugars / Sucres 39 g" has no carbs
  // line). The label-corrected result must NOT inherit the DB's carbs — that
  // would create sugar (39) > carbs (~11), a nutritionally impossible
  // relationship for a result we're claiming is trustworthy.
  const db = cherryCokeDb();
  db.per100g = { ...db.per100g, carbs: 3 };
  const { labelResult } = buildLabelConflict(db, goodLabel);
  expect(labelResult).toBeDefined();
  expect(labelResult!.perServing.carbs).toBeUndefined();
  expect(labelResult!.per100g.carbs).toBeUndefined();
  expect(labelResult!.perServing.sugar).toBeCloseTo(39, 0);
});

it("partial DoD-shorthand label (calories + sugar only) never produces carbs < sugar", () => {
  // The exact DoD-shorthand shape OCR field-drop produces: calories + sugar
  // read, totalFat explicitly 0, saturatedFat unread. Carbs is never part of
  // LabelNutritionInput, so it can only come from the DB — which here HAS a
  // (wrong, uniformly-mis-scaled) carbs value. Assert the numeric invariant
  // directly (not just "carbs is undefined") so a future change that starts
  // defaulting carbs to 0 instead of leaving it undefined still gets caught.
  const db = cherryCokeDb();
  db.per100g = { ...db.per100g, carbs: 3 };
  const dodLabel: LabelNutritionInput = {
    calories: 150,
    totalSugars: 39,
    totalFat: 0,
    saturatedFat: null,
    servingSize: "355 mL",
  };
  const { labelResult } = buildLabelConflict(db, dodLabel);
  expect(labelResult).toBeDefined();
  const { carbs, sugar } = labelResult!.perServing;
  expect(carbs !== undefined && sugar !== undefined && sugar > carbs).toBe(
    false,
  );
});

it("no override when the label serving grossly disagrees with a trusted DB serving", () => {
  // True 80 g serving whose grams OCR-misreads to "800 mL" (stray zero, < the
  // 2000 cap): the label per-100 would deflate and suppress a flag the base
  // result gets right. The trusted DB serving (80 g) is the anchor — a 10x
  // disagreement means the label grams are a misread, so decline to override.
  const db = cherryCokeDb();
  db.servingInfo = { displayLabel: "80 g", grams: 80, wasCorrected: false };
  const r = buildLabelConflict(db, { ...goodLabel, servingSize: "800 mL" });
  expect(r.conflict).toBe(false);
  expect(r.labelResult).toBeUndefined();
});

// ── `compared`: did we actually check the label against the record? ──
//
// `conflict: false` is returned by four different situations, only ONE of which
// means the label agreed. The client stakes its one-tap log gate on telling them
// apart, so each decline path is pinned here.

it("compared is true when the label was checked and materially disagreed", () => {
  expect(buildLabelConflict(cherryCokeDb(), goodLabel).compared).toBe(true);
});

it("compared is true when the label was checked and agreed", () => {
  const db = cherryCokeDb();
  db.per100g = { calories: 42, sugar: 11, fat: 0 };
  db.perServing = { calories: 149, sugar: 39, fat: 0 };
  const r = buildLabelConflict(db, goodLabel);
  expect(r.conflict).toBe(false);
  // The distinction that matters: no conflict AND we really did compare, so the
  // record is corroborated by the package and one-tap logging is justified.
  expect(r.compared).toBe(true);
});

it("decline #1: compared is false when the label serving does not parse to grams", () => {
  // The reachable client case: SERVING_SIZE_PATTERN captures to end-of-line, so
  // an OCR line-break yields "1 Can" — non-empty (so the client POSTs) but with
  // no g/ml token for parseServingGrams.
  const r = buildLabelConflict(cherryCokeDb(), {
    ...goodLabel,
    servingSize: "1 Can",
  });
  expect(r.conflict).toBe(false);
  expect(r.compared).toBe(false);
});

it("decline #2: compared is false when the label serving is implausibly large", () => {
  const r = buildLabelConflict(cherryCokeDb(), {
    ...goodLabel,
    servingSize: "3550 mL",
  });
  expect(r.conflict).toBe(false);
  expect(r.compared).toBe(false);
});

it("decline #2b: compared is false when the label serving disagrees >4x with a trusted DB serving", () => {
  const db = cherryCokeDb();
  db.servingInfo = { displayLabel: "80 g", grams: 80, wasCorrected: false };
  const r = buildLabelConflict(db, { ...goodLabel, servingSize: "800 mL" });
  expect(r.conflict).toBe(false);
  expect(r.compared).toBe(false);
});

it("decline #3: compared is false when the record has no counterpart for any field the label read", () => {
  // Serving parses and the ratio is fine, so we get all the way to the
  // comparison loop — but the DB per-100g has none of calories/sugar/fat, so
  // nothing is ever compared. Without `compared` this is indistinguishable from
  // the agreement case above, and the client would open the gate on a record it
  // never verified.
  const db = cherryCokeDb();
  db.per100g = { caffeine: 10 };
  const r = buildLabelConflict(db, goodLabel);
  expect(r.conflict).toBe(false);
  expect(r.fields).toEqual([]);
  expect(r.compared).toBe(false);
});

it("presence-gate declines also report compared false", () => {
  expect(
    buildLabelConflict(cherryCokeDb(), { ...goodLabel, calories: null })
      .compared,
  ).toBe(false);
});

// ── `saturatedFat` IS corroborated against the record (see the comment above
// `cmp` in label-override.ts). Two policies distinguish it from the other
// three fields, and each has its own tests below:
//
//   1. It carries a quantization floor derived from the 0.5 g step a Nutrition
//      Facts panel prints saturated fat in, scaled by the same per-serving →
//      per-100 `factor` the reading itself is scaled by. Without it the
//      2-5 g/100g band conflicts on rounding alone.
//   2. Its AGREEMENT does not count toward `comparedCount`, so it can raise a
//      conflict but can never help open the `compared >= 2` one-tap-log gate.
//
// A fatty-product fixture (cheddar-like, 30 g serving) is used for most of
// these rather than the beverage one: saturated fat is only interesting where
// it is nonzero, and the small serving is what makes the rounding
// amplification visible (factor 3.33, so a 0.5 g printed step is 1.67 g at
// per-100 scale).

/**
 * Cheddar-like fixture: 30 g label serving against a trusted 28 g DB serving
 * (close enough to clear the >4x/<0.25x serving cross-check, which the 355 ml
 * beverage default would otherwise trip before any comparison runs).
 * calories/sugar/fat are offset by a real amount INSIDE tolerance rather than
 * being identical, so `valuesMatch`'s relative and absolute-floor branches are
 * genuinely exercised instead of its `a === b` shortcut.
 */
function cheddarDb(saturatedFat: number | undefined): BarcodeLookupResult {
  const db = cherryCokeDb();
  db.servingInfo = { displayLabel: "28 g", grams: 28, wasCorrected: false };
  db.per100g = {
    calories: 380, // within 25% of the label's ~403.3
    sugar: 1.5, // within the <2 g absolute ±1 floor of the label's ~1.33
    fat: 30, // within 25% of the label's ~33.3
    saturatedFat,
    // Un-read siblings: `LabelNutritionInput` has no field for any of these, so
    // they can only ever come from the record. They are what the blanking-scope
    // tests below are about — without them those assertions would be vacuous.
    carbs: 2,
    protein: 24,
    sodium: 650,
  };
  return db;
}

const cheddarLabel: LabelNutritionInput = {
  calories: 121, // 30 g serving; scales to ~403.3 per-100
  totalSugars: 0.4, // -> ~1.33 per-100
  totalFat: 10, // -> ~33.3 per-100
  saturatedFat: 6.3, // -> ~21 per-100
  servingSize: "30 g",
  // Provenance: a DIRECT glyph read, so the server is allowed to compare it.
  // Every test below that expects a saturatedFat comparison to happen needs
  // this — an absent list means "not a direct read" and skips the row. The
  // absent and inferred cases have their own tests further down.
  directReads: ["saturatedFat"],
};

it("a saturatedFat disagreement beyond the rounding floor conflicts on its own", () => {
  // calories/sugar/fat all agree; only saturatedFat disagrees — ~21 per-100
  // from the label against the record's 2. That gap (19) dwarfs both the 25%
  // relative tolerance and the 1.67 g/100g quantization floor a 30 g serving
  // produces, so it is a real disagreement and must be reported as one.
  //
  // This is the behaviour the previous revision of this branch deliberately
  // did NOT have: the same fixture was a "negative control" asserting no
  // conflict. Overridden — writing a photographed number over the record
  // without ever checking it against the record is the defect.
  const r = buildLabelConflict(cheddarDb(2), cheddarLabel);
  expect(r.conflict).toBe(true);
  expect(r.fields).toEqual(["saturatedFat"]);
  // And the conflict is acted on: the label's value replaces the record's.
  expect(r.labelResult!.per100g.saturatedFat).toBeCloseTo(21, 5);
});

it("an agreeing saturatedFat produces no conflict", () => {
  // Same fixture, record's saturatedFat within 25% of the label's ~21.
  const r = buildLabelConflict(cheddarDb(20.5), cheddarLabel);
  expect(r.conflict).toBe(false);
  expect(r.fields).toEqual([]);
  // Still `compared` — calories/sugar/fat are three corroborating agreements.
  expect(r.compared).toBe(true);
});

/**
 * THE DISCRIMINATING TEST for the quantization floor.
 *
 * FDA/CFIA quantize printed saturated fat to 0.5 g steps, and the label is
 * read PER SERVING then multiplied by `factor = 100 / labelGrams`, which
 * multiplies that rounding error too. On this 30 g serving `factor` is 3.33,
 * so ONE printed step is 1.67 g at the per-100 scale being compared — while
 * `valuesMatch`'s 25% relative branch allows only 1.25 g at 5 g/100g. Two
 * genuinely agreeing labels would therefore be reported as conflicting, and a
 * conflict is expensive: it blanks the record's carbs/protein/fiber/sodium.
 *
 * The values below are exactly one printed step apart. The label prints 1.5 g
 * per 30 g serving (5.0 per-100); the record's 3.4 per-100 is ~1.02 g on the
 * same serving. Relative check: 1.6 / 5.0 = 32% — FAILS. Floor: 1.6 <= 1.67 —
 * so the gap is fully explained by rounding and must not be called a conflict.
 *
 * Non-vacuity: verified to FAIL (conflict true, fields ["saturatedFat"]) when
 * the `roundingFloor` term is removed from the comparison loop.
 */
it("does NOT conflict when label and record saturatedFat differ by one printed rounding step", () => {
  const label: LabelNutritionInput = { ...cheddarLabel, saturatedFat: 1.5 };
  const r = buildLabelConflict(cheddarDb(3.4), label);
  expect(r.conflict).toBe(false);
  expect(r.fields).toEqual([]);
  expect(r.labelResult).toBeUndefined();
  // Both values sit above 2, so `valuesMatch`'s ±1 absolute branch is NOT what
  // saved this — the floor is. Pin that the relative check really did fail.
  expect(valuesMatch(1.5 * (100 / 30), 3.4, 0.25)).toBe(false);
});

it("conflict path: label saturatedFat rides through when it AGREES with the record", () => {
  // Conflict is triggered by calories/sugar (goodLabel vs. the unmodified
  // Cherry Coke DB, same as the very first test in this file). The record
  // carries a saturatedFat matching the label's scaled reading, so
  // saturatedFat stays OUT of `fields` — this assertion is unchanged from
  // when the field was excluded from `cmp`, but for a different reason: it is
  // now compared and agrees, rather than never being compared.
  const db = cherryCokeDb();
  db.per100g = { ...db.per100g, saturatedFat: 1 }; // 3.55g / 355mL * 100 = 1
  const label: LabelNutritionInput = {
    ...goodLabel,
    saturatedFat: 3.55,
    directReads: ["saturatedFat"],
  };
  const r = buildLabelConflict(db, label);
  expect(r.conflict).toBe(true);
  expect(r.fields).toEqual(["calories", "sugar"]);
  expect(r.labelResult!.per100g.saturatedFat).toBeCloseTo(1, 5);
});

it("conflict path: a DISAGREEING saturatedFat now joins `fields` alongside the others", () => {
  const db = cherryCokeDb();
  db.per100g = { ...db.per100g, saturatedFat: 10 }; // wildly different from 1
  const label: LabelNutritionInput = {
    ...goodLabel,
    saturatedFat: 3.55,
    directReads: ["saturatedFat"],
  };
  const r = buildLabelConflict(db, label);
  expect(r.conflict).toBe(true);
  // The 355 ml serving makes `factor` 0.28, so the floor here is only 0.14 —
  // a 9 g/100g gap is nowhere near explainable by rounding.
  expect(r.fields).toEqual(["calories", "sugar", "saturatedFat"]);
  // The label's value still wins in the merged block — not the DB's, not a
  // blend. Corroboration changes what the user is TOLD differs, not which
  // source the conflict path adopts.
  expect(r.labelResult!.per100g.saturatedFat).toBeCloseTo(1, 5);
});

// ── `comparedCount`: saturatedFat is compared, but its agreement is not
// evidence the SCREEN was checked.

it("saturatedFat agreement does not raise comparedCount — the compared>=2 gate stays shut on calories alone", () => {
  // Calories-only label (sugar/fat unread), mirroring "agreement on calories
  // alone does not claim the label was verified" above, PLUS a saturatedFat
  // reading that IS compared here and agrees (18 g / 355 ml = 5.07 per-100 vs
  // the record's 5 — that value is load-bearing, not arbitrary).
  //
  // Correct behaviour: `comparedCount` stays 1, so `compared` stays false.
  // saturatedFat's agreement test was deliberately widened by the quantization
  // floor, which makes it materially weaker evidence than the other three — so
  // it must not be the field that tips a trust gate the client stakes one-tap
  // logging on. If `corroborates` were flipped to true, comparedCount would go
  // 1 -> 2 and this would flip to `compared: true`.
  //
  // This case can only be built with an AGREEING saturatedFat: a disagreeing
  // one takes the conflict path, where `compared` is unconditionally true.
  const db = cherryCokeDb();
  db.per100g = { calories: 39.4, sugar: 11, fat: 0, saturatedFat: 5 };
  const r = buildLabelConflict(db, {
    calories: 140,
    totalSugars: null,
    totalFat: null,
    saturatedFat: 18,
    servingSize: "1 can (355 mL)",
    directReads: ["saturatedFat"],
  });
  expect(r.conflict).toBe(false);
  expect(r.compared).toBe(false);
});

it("saturatedFat as the ONLY comparable field: disagreement conflicts, and the conflict path still reports compared", () => {
  // The record has no calories/sugar/fat per-100 counterpart at all, so
  // `comparedCount` is 0 — yet saturatedFat disagrees far beyond the floor and
  // raises a conflict. `compared: true` is right on this path for the same
  // reason it always was: the label's values REPLACE the ones they disagree
  // with, so what is displayed did come from the package.
  const db = cheddarDb(2);
  db.per100g = { saturatedFat: 2 };
  const r = buildLabelConflict(db, {
    ...cheddarLabel,
    totalSugars: null,
    totalFat: null,
  });
  expect(r.conflict).toBe(true);
  expect(r.fields).toEqual(["saturatedFat"]);
  expect(r.compared).toBe(true);
});

it("saturatedFat as the ONLY comparable field: agreement alone does NOT claim the label was verified", () => {
  // The mirror of the case above. Nothing disagreed, but the single field that
  // agreed does not count toward `comparedCount`, so the one-tap-log gate
  // stays shut — the sugar, fat, protein and sodium on screen were never
  // checked against anything.
  const db = cheddarDb(20.5);
  db.per100g = { saturatedFat: 20.5 };
  const r = buildLabelConflict(db, {
    ...cheddarLabel,
    totalSugars: null,
    totalFat: null,
  });
  expect(r.conflict).toBe(false);
  expect(r.fields).toEqual([]);
  expect(r.compared).toBe(false);
});

// ── PROVENANCE: an INFERRED saturatedFat is accepted and adopted, but never
// compared.
//
// The parser can reconstruct `saturatedFat` from its `totalFat` parent via the
// `gluedUnitIsForced` containment rule. That inference's error is bounded only
// by `[0, totalFat]`, while `roundingFloor` is sized for a 0.5 g printing step
// — so comparing an inference at that tolerance lets a wrong one condemn the
// record on its own. `directReads` is how the payload says which it was.

it("does NOT compare saturatedFat when the payload carries NO provenance at all", () => {
  // The old-client shape: `directReads` is literally ABSENT from the object,
  // which is what every already-installed build and every older OTA bundle
  // sends. Absent must read as "not a direct read" — never as "direct".
  //
  // Built by DELETING the key rather than passing `[]`, because those are
  // different inputs and only this one models the client that exists in the
  // field. (Same reasoning as
  // docs/solutions/logic-errors/absent-field-beats-defaulted-one-in-a-precedence-chain-2026-07-31.md,
  // which is about testing the encoding production actually emits.) The `[]`
  // case is the test immediately below.
  const { directReads: _omitted, ...noProvenance } = cheddarLabel;
  expect(noProvenance).not.toHaveProperty("directReads");

  // Identical to "a saturatedFat disagreement beyond the rounding floor
  // conflicts on its own" above — same fixture, same 19 g/100g gap — except
  // for the missing provenance. There it conflicts; here it must not.
  const r = buildLabelConflict(cheddarDb(2), noProvenance);
  expect(r.conflict).toBe(false);
  expect(r.fields).toEqual([]);
  // Still `compared`: calories/sugar/fat are three corroborating agreements and
  // they were checked. Only the saturatedFat ROW was skipped.
  expect(r.compared).toBe(true);
});

it("does NOT compare saturatedFat when provenance is present but does not list it", () => {
  // The new-client inferred shape: the parser read calories/fat directly and
  // reconstructed saturatedFat, so the field is sent (and still adopted) but
  // is not in `directReads`.
  const r = buildLabelConflict(cheddarDb(2), {
    ...cheddarLabel,
    directReads: ["calories", "totalFat"],
  });
  expect(r.conflict).toBe(false);
  expect(r.fields).toEqual([]);
});

it("an unrecognised provenance entry is inert, not a comparison licence", () => {
  // The wire type is loose strings so a newer client's extra key cannot 400 the
  // whole request. Prove the looseness cannot be turned into a false positive:
  // a list naming something else entirely still does not license saturatedFat.
  const r = buildLabelConflict(cheddarDb(2), {
    ...cheddarLabel,
    directReads: ["somethingElse"],
  });
  expect(r.conflict).toBe(false);
});

it("still ADOPTS an unopposed inferred saturatedFat — provenance gates comparison, not adoption", () => {
  // The label remains the source of truth for what it read. A conflict raised
  // by calories/sugar still carries the label's saturatedFat into the corrected
  // block even though that reading was never corroborated, exactly as it did
  // before provenance existed.
  const db = cherryCokeDb();
  db.per100g = { ...db.per100g, saturatedFat: 10 };
  const r = buildLabelConflict(db, { ...goodLabel, saturatedFat: 3.55 });
  expect(r.conflict).toBe(true);
  // saturatedFat is NOT reported as differing — it was never compared — but its
  // value is still the label's (3.55 g / 355 mL * 100 = 1), not the record's 10.
  expect(r.fields).toEqual(["calories", "sugar"]);
  expect(r.labelResult!.per100g.saturatedFat).toBeCloseTo(1, 5);
});

// ── BLANKING SCOPE: a conflict raised only by non-corroborating fields must not
// discard the record's un-read macros.
//
// `LabelNutritionInput` has no carbs/protein/sodium field, so those can only
// come from the record. The blanking rationale was written for the Cherry Coke
// shape, where a CALORIES disagreement implies the record's whole per-100 basis
// is wrong. A saturatedFat-only disagreement with the other three AGREEING is
// the case that disproves a basis-wide error rather than evidencing one.

it("keeps the record's un-read macros when ONLY a non-corroborating field disagrees", () => {
  // The reviewer's reproduction: db calories 380 / sugar 1.5 / fat 30 /
  // satFat 2 / carbs 2 / protein 24 / sodium 650, against a label that agrees
  // on calories, sugar and fat and disagrees only on saturatedFat.
  const r = buildLabelConflict(cheddarDb(2), cheddarLabel);
  expect(r.conflict).toBe(true);
  expect(r.fields).toEqual(["saturatedFat"]);

  // The conflict is still acted on: the label's saturatedFat replaces the
  // record's.
  expect(r.labelResult!.per100g.saturatedFat).toBeCloseTo(21, 5);
  // ...but the three macros nothing disagreed about survive. Before this fix
  // all three were `undefined`, which also silences every FSA flag they would
  // have raised — 650 mg/100g of sodium is above the FSA_FOOD high line.
  expect(r.labelResult!.per100g.carbs).toBe(2);
  expect(r.labelResult!.per100g.protein).toBe(24);
  expect(r.labelResult!.per100g.sodium).toBe(650);
});

it("never retains a DB total fat that the label's corrected saturated fat exceeds", () => {
  // The impossible-relationship trap the OLD unconditional blanking made
  // unreachable, one level down from the blanking scope itself. Keeping the
  // record's siblings is right for carbs/protein/sodium — the label has no
  // field for any of them — but `fat` is `saturatedFat`'s CONTAINMENT PARENT,
  // and this is the one path where the two can come from different sources.
  //
  // The shape is a real parse, not a contrivance: the parser DECLINES a glued
  // "Total Fat 19" (nothing to bound it), while "Saturated Fat 6 g" one line
  // below is an ordinary direct read. So a panel can legitimately yield
  // `totalFat: null` alongside a directly-read `saturatedFat`.
  const db = cheddarDb(2);
  db.per100g = { ...db.per100g, fat: 3 }; // record says 3 g/100g of total fat
  const r = buildLabelConflict(db, {
    ...cheddarLabel,
    totalSugars: null,
    totalFat: null, // the glued-form decline
  });
  expect(r.conflict).toBe(true);
  expect(r.fields).toEqual(["saturatedFat"]);

  // The label's saturated fat is adopted: 6.3 g / 30 g = 21 per-100.
  expect(r.labelResult!.per100g.saturatedFat).toBeCloseTo(21, 5);
  // Assert the INVARIANT, not just "fat is undefined" — mirroring the
  // sugar > carbs tests above, so a future change that starts defaulting fat
  // to 0 instead of dropping it is still caught.
  const { fat, saturatedFat } = r.labelResult!.per100g;
  expect(
    fat !== undefined && saturatedFat !== undefined && saturatedFat > fat,
  ).toBe(false);
  // And the fix stays narrow: the three macros with no containment relationship
  // to anything the label corrected are still kept.
  expect(r.labelResult!.per100g.carbs).toBe(2);
  expect(r.labelResult!.per100g.protein).toBe(24);
  expect(r.labelResult!.per100g.sodium).toBe(650);
});

it("keeps a DB total fat that COMFORTABLY contains the corrected saturated fat", () => {
  // The negative control that keeps the guard from collapsing into "always drop
  // fat". The unmodified fixture's 30 g/100g of fat holds 21 g of saturated fat
  // without contradiction, so there is nothing to protect the user from and the
  // value is worth displaying.
  const r = buildLabelConflict(cheddarDb(2), {
    ...cheddarLabel,
    totalSugars: null,
    totalFat: null,
  });
  expect(r.fields).toEqual(["saturatedFat"]);
  expect(r.labelResult!.per100g.fat).toBe(30);
});

it("STILL blanks the un-read macros when a corroborating field disagrees too", () => {
  // The Cherry Coke rule, pinned on the same fixture so the two branches differ
  // in exactly one thing: whether a corroborating field is among the
  // disagreements. Here the record's calories are wrong as well, which is the
  // uniform-basis error the blanking exists for — so carbs, protein and sodium
  // go, saturatedFat notwithstanding.
  const db = cheddarDb(2);
  db.per100g = { ...db.per100g, calories: 100 }; // vs the label's ~403
  const r = buildLabelConflict(db, cheddarLabel);
  expect(r.conflict).toBe(true);
  expect(r.fields).toEqual(["calories", "saturatedFat"]);
  expect(r.labelResult!.per100g.carbs).toBeUndefined();
  expect(r.labelResult!.per100g.protein).toBeUndefined();
  expect(r.labelResult!.per100g.sodium).toBeUndefined();
});

// ── FLOOR CLAMP: `step * factor` is unbounded, and `parseLabelServingGrams`
// enforces no minimum serving.

it("clamps the rounding floor so a tiny serving cannot swallow an FSA band crossing", () => {
  // A 5 g serving (a spread/condiment portion) gives `factor` 20, so the raw
  // floor would be 10 g/100g — nearly 3x the entire FSA_FOOD saturated-fat
  // MEDIUM band (1.5 -> 5.0). Unclamped, the comparison could not see ANY
  // crossing of the high-saturated-fat line.
  //
  // Label 0.5 g per 5 g serving = 10 per-100, which is HIGH on the FSA food
  // scale; the record's 4.0 is MEDIUM. The gap is 6: the 25% relative branch
  // allows only 2.5, and the clamped floor is (5.0 - 1.5) / 2 = 1.75. So it is
  // a real disagreement.
  //
  // Non-vacuity: with the `Math.min(...)` clamp removed the floor is 10, 6 <= 10
  // holds, and this returns `conflict: false`.
  const db = cherryCokeDb();
  db.servingInfo = { displayLabel: "5 g", grams: 5, wasCorrected: false };
  db.per100g = { calories: 400, saturatedFat: 4.0 };
  const r = buildLabelConflict(db, {
    calories: 20, // -> 400 per-100, agreeing with the record
    totalSugars: null,
    totalFat: null,
    saturatedFat: 0.5,
    servingSize: "5 g",
    directReads: ["saturatedFat"],
  });
  expect(r.conflict).toBe(true);
  expect(r.fields).toEqual(["saturatedFat"]);
});

it("uses the narrower DRINK ceiling when the label's serving is in millilitres", () => {
  // The two FSA scales differ by 2x, so the ceiling is scale-aware: 1.75 for
  // food, (2.5 - 0.75) / 2 = 0.875 for drinks. This gap discriminates them.
  //
  // 15 ml serving -> `factor` 6.67, raw floor 3.33. Label 0.3 g -> 2.0 per-100;
  // record 0.8. Gap 1.2: above the drink ceiling (0.875) so it conflicts, but
  // BELOW the food ceiling (1.75) — if the food band were applied here this
  // would be silently forgiven.
  const db = cherryCokeDb();
  db.servingInfo = { displayLabel: "15 mL", grams: 15, wasCorrected: false };
  db.per100g = { calories: 66.7, saturatedFat: 0.8 };
  const r = buildLabelConflict(db, {
    calories: 10, // -> 66.7 per-100, agreeing
    totalSugars: null,
    totalFat: null,
    saturatedFat: 0.3,
    servingSize: "15 mL",
    directReads: ["saturatedFat"],
  });
  expect(r.conflict).toBe(true);
  expect(r.fields).toEqual(["saturatedFat"]);
});

it("the clamp does not disturb the ordinary 30 g serving the floor exists for", () => {
  // Regression guard on the bound itself. At `factor` 3.33 the raw floor is
  // 1.667, just under the 1.75 food ceiling — so the discriminating
  // one-printed-step case above is decided by the DERIVED floor, not by the
  // clamp. A tighter ceiling (e.g. half the drink band) would silently convert
  // that test into a conflict and reintroduce rounding-only false positives.
  const r = buildLabelConflict(cheddarDb(3.4), {
    ...cheddarLabel,
    saturatedFat: 1.5,
  });
  expect(r.conflict).toBe(false);
});
