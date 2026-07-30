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
it("keeps the DB's un-read nutrients when the label read no macros", () => {
  const db = cherryCokeDb();
  db.per100g = { ...db.per100g, sugar: 11, fat: 0 };
  const r = buildLabelConflict(db, {
    calories: 140,
    totalSugars: null,
    totalFat: null,
    saturatedFat: null,
    servingSize: "1 can (355 mL)",
  });

  expect(r.labelResult).toBeDefined();
  // The label's calories win...
  expect(r.labelResult!.perServing.calories).toBe(140);
  // ...but the record's sugar survives, so the high-sugar warning can still fire.
  expect(r.labelResult!.per100g.sugar).toBe(11);
  expect(r.labelResult!.perServing.sugar).toBeCloseTo(39, 0);
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
