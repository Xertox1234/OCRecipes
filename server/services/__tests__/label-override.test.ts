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

it("presence gate: no conflict when calories or all macros are unread", () => {
  const noCals = buildLabelConflict(cherryCokeDb(), {
    ...goodLabel,
    calories: null,
  });
  expect(noCals.conflict).toBe(false);
  const noMacros = buildLabelConflict(cherryCokeDb(), {
    calories: 150,
    totalSugars: null,
    totalFat: null,
    saturatedFat: null,
    servingSize: "355 mL",
  });
  expect(noMacros.conflict).toBe(false);
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
