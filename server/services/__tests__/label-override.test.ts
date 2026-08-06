import { it, expect } from "vitest";
import {
  buildLabelConflict,
  type LabelNutritionInput,
} from "../label-override";
import type { BarcodeLookupResult } from "../barcode-lookup";

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

// ── `saturatedFat` is deliberately NOT in `cmp` (see the comment above `cmp`
// in label-override.ts). Two of the tests below are the actual regression
// guards, each catching a different half of "saturatedFat silently rejoins
// `cmp`": the DISAGREES test catches it via `fields` (a re-admitted field
// that disagrees gets pushed there), and the comparedCount test below catches
// it via `compared` (a re-admitted field that agrees raises `comparedCount`).
// The AGREES test and the negative control's agreeing branch are agreement
// cases, which `fields`/`compared` cannot distinguish from "not compared at
// all" — they exist to document the accepted behavior (the label's value
// rides through unconditionally either way), not to catch that regression.

it("conflict path: label saturatedFat rides through even when it AGREES with the DB", () => {
  // Conflict is triggered by calories/sugar (goodLabel vs. the unmodified
  // Cherry Coke DB, same as the very first test in this file). DB carries a
  // saturatedFat that matches the label's scaled reading exactly.
  const db = cherryCokeDb();
  db.per100g = { ...db.per100g, saturatedFat: 1 }; // 3.55g / 355mL * 100 = 1
  const label: LabelNutritionInput = { ...goodLabel, saturatedFat: 3.55 };
  const r = buildLabelConflict(db, label);
  expect(r.conflict).toBe(true);
  // `fields` is what the client is told "differs" — saturatedFat must never
  // appear in it, agree or disagree, since it was never in `cmp`.
  expect(r.fields).toEqual(["calories", "sugar"]);
  expect(r.labelResult!.per100g.saturatedFat).toBeCloseTo(1, 5);
});

it("conflict path: label saturatedFat rides through even when it DISAGREES with the DB", () => {
  const db = cherryCokeDb();
  db.per100g = { ...db.per100g, saturatedFat: 10 }; // wildly different from 1
  const label: LabelNutritionInput = { ...goodLabel, saturatedFat: 3.55 };
  const r = buildLabelConflict(db, label);
  expect(r.conflict).toBe(true);
  // Disagreement alone must NOT add "saturatedFat" to `fields` — if it did,
  // that would mean the field silently rejoined `cmp`.
  expect(r.fields).toEqual(["calories", "sugar"]);
  // The label's (uncorroborated) value wins — not the DB's, not a blend.
  expect(r.labelResult!.per100g.saturatedFat).toBeCloseTo(1, 5);
});

it("negative control: a disagreeing saturatedFat alone does NOT create a conflict when calories/sugar/fat all agree", () => {
  // A fatty-product shape (cheddar-like, 30g serving) rather than the
  // beverage fixture: nonzero totalFat with saturatedFat inside it (a
  // physically real relationship), and DB calories/sugar/fat offset by a
  // real amount within tolerance — NOT identical to the label's scaled
  // values — so this exercises `valuesMatch`'s actual relative/absolute-floor
  // branches rather than its `a === b` shortcut.
  const label: LabelNutritionInput = {
    calories: 121, // 30g serving; scales to ~403.3 per-100
    totalSugars: 0.4, // -> ~1.33 per-100
    totalFat: 10, // -> ~33.3 per-100
    saturatedFat: 6.3, // -> ~21 per-100 — wildly disagrees with the DB below
    servingSize: "30 g",
  };
  const dbDisagree = cherryCokeDb();
  // Also set a trusted DB serving close to the label's 30g — cherryCokeDb's
  // default 355ml serving would otherwise trip the >4x/<0.25x cross-check
  // ratio guard before the comparison this test targets is even reached.
  dbDisagree.servingInfo = {
    displayLabel: "28 g",
    grams: 28,
    wasCorrected: false,
  };
  dbDisagree.per100g = {
    calories: 380, // within 25% of ~403.3
    sugar: 1.5, // within the <2g absolute ±1 floor of ~1.33
    fat: 30, // within 25% of ~33.3
    saturatedFat: 2, // disagrees hugely with the label's ~21
  };
  const rDisagree = buildLabelConflict(dbDisagree, label);
  expect(rDisagree.conflict).toBe(false);
  expect(rDisagree.fields).toEqual([]);
  expect(rDisagree.labelResult).toBeUndefined();
  expect(rDisagree.compared).toBe(true);

  // Same fixture but saturatedFat also agrees — documents that agreement
  // takes the identical path (this assertion alone can't distinguish
  // "not compared" from "compared and agreed"; the dedicated comparedCount
  // test below is what actually pins that saturatedFat's agreement can't
  // raise `comparedCount`).
  const dbAgree = cherryCokeDb();
  dbAgree.servingInfo = {
    displayLabel: "28 g",
    grams: 28,
    wasCorrected: false,
  };
  dbAgree.per100g = {
    calories: 380,
    sugar: 1.5,
    fat: 30,
    saturatedFat: 20.5, // agrees with the label's ~21
  };
  const rAgree = buildLabelConflict(dbAgree, label);
  expect(rAgree.conflict).toBe(false);
  expect(rAgree.compared).toBe(true);
});

it("saturatedFat agreement never raises comparedCount — the compared>=2 gate stays shut on calories alone", () => {
  // Calories-only label (sugar/fat unread), mirroring "agreement on calories
  // alone does not claim the label was verified" above, PLUS a saturatedFat
  // reading that also agrees with the DB. Correct behaviour: comparedCount
  // stays 1 (calories only), so `compared` stays false. If saturatedFat were
  // silently re-admitted to `cmp`, comparedCount would go 1 -> 2 and flip
  // `compared` to true — exactly the "loosens the compared >= 2 gate" risk
  // the code comment above `cmp` names.
  const db = cherryCokeDb();
  db.per100g = { calories: 39.4, sugar: 11, fat: 0, saturatedFat: 5 };
  const r = buildLabelConflict(db, {
    calories: 140,
    totalSugars: null,
    totalFat: null,
    saturatedFat: 18, // arbitrary — never compared, so its value is moot
    servingSize: "1 can (355 mL)",
  });
  expect(r.conflict).toBe(false);
  expect(r.compared).toBe(false);
});
