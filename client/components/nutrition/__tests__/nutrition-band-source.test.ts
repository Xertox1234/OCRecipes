import { describe, it, expect } from "vitest";

import { selectBandSource, buildPanelRows } from "../nutrition-band-source";
import type { NutritionData } from "@/hooks/useNutritionLookup";
import type { ValidatedNutrition } from "@/lib/serving-size-utils";

/** Cherry Coke: 39 g sugar per 355 ml can, 11.0 g per 100 ml → MEDIUM on the drink scale. */
const cherryCokeValidated: ValidatedNutrition = {
  per100g: {
    calories: 44,
    sugar: 11.0,
    sodium: 11,
    fat: 0,
    protein: 0,
    fiber: 0,
  },
  perServing: {
    calories: 156,
    sugar: 39,
    sodium: 39,
    fat: 0,
    protein: 0,
    fiber: 0,
  },
  servingInfo: {
    displayLabel: "1 can (355 mL)",
    grams: 355,
    wasCorrected: false,
  },
  isServingDataTrusted: true,
};

const cherryCokeNutrition: NutritionData = {
  productName: "Cherry Coke",
  servingSize: "1 can (355 mL)",
  calories: 156,
  sugar: 39,
  sodium: 39,
  fat: 0,
  protein: 0,
  fiber: 0,
};

describe("selectBandSource — serving invariance (the defect this module exists for)", () => {
  it("returns the SAME basis and values however the serving controls are set", () => {
    // `nutrition` is display state: recalculateNutrition multiplies it by
    // servingSizeGrams x servingQuantity. Two servings of the same can.
    const doubled: NutritionData = {
      ...cherryCokeNutrition,
      calories: 312,
      sugar: 78,
      sodium: 78,
    };

    const atOne = selectBandSource({
      itemId: undefined,
      validatedData: cherryCokeValidated,
      nutrition: cherryCokeNutrition,
      isBeverage: true,
    });
    const atTwo = selectBandSource({
      itemId: undefined,
      validatedData: cherryCokeValidated,
      nutrition: doubled,
      isBeverage: true,
    });

    expect(atTwo).toEqual(atOne);
    expect(atOne.values.sugar).toBe(11.0);
    expect(atOne.basis).toEqual({
      kind: "resolved",
      scale: "drink",
      factor: 1,
    });
  });

  it("bands Cherry Coke MEDIUM on the drink scale, not HIGH", () => {
    const { rows } = buildPanelRows({
      itemId: undefined,
      validatedData: cherryCokeValidated,
      nutrition: cherryCokeNutrition,
      isBeverage: true,
    });
    const sugar = rows.find((r) => r.row.key === "sugar");
    expect(sugar?.band).toEqual({ group: "concern", band: "medium" });
  });

  it("bands sugar MEDIUM even at quantity 2, while the DISPLAYED value doubles", () => {
    const doubled: NutritionData = { ...cherryCokeNutrition, sugar: 78 };
    const { rows } = buildPanelRows({
      itemId: undefined,
      validatedData: cherryCokeValidated,
      nutrition: doubled,
      isBeverage: true,
    });
    const sugar = rows.find((r) => r.row.key === "sugar");
    expect(sugar?.band).toEqual({ group: "concern", band: "medium" });
    expect(sugar?.displayValue).toBe(78);
  });
});

describe("selectBandSource — the SCALE channel (servingSize is ALSO rewritten)", () => {
  // `recalculateNutrition` doesn't only scale the VALUES — on its gram branch
  // it overwrites `nutrition.servingSize` to `${grams}g` (useNutritionLookup.ts:301).
  // `isBeverage: null` is required to expose this: it forces resolveBasis to
  // infer scale from the serving string's UNIT, so any regression that reads
  // `nutrition.servingSize` instead of `validatedData.servingInfo.displayLabel`
  // shows up here even though `factor` stays pinned at 1 either way.
  it("keeps the drink scale when nutrition.servingSize has been rewritten to a gram string", () => {
    const source = selectBandSource({
      itemId: undefined,
      validatedData: cherryCokeValidated, // servingInfo.displayLabel: "1 can (355 mL)"
      nutrition: { ...cherryCokeNutrition, servingSize: "355g" },
      isBeverage: null,
    });
    expect(source.basis).toEqual({
      kind: "resolved",
      scale: "drink",
      factor: 1,
    });
  });

  it("stays unbanded rather than fabricating a scale from the rewritten servingSize", () => {
    // The ORIGINAL serving string ("1 bottle", unparseable) governs, not a
    // later gram string that happens to parse. Fabricating a basis here is
    // exactly what Global Constraint 2 forbids.
    const source = selectBandSource({
      itemId: undefined,
      validatedData: {
        ...cherryCokeValidated,
        servingInfo: {
          displayLabel: "1 bottle",
          grams: null,
          wasCorrected: false,
        },
      },
      nutrition: { ...cherryCokeNutrition, servingSize: "100g" },
      isBeverage: null,
    });
    expect(source.basis).toEqual({ kind: "unknown" });
  });
});

describe("selectBandSource — path selection", () => {
  it("scan path with no validatedData yields an unknown basis, never a guess", () => {
    const source = selectBandSource({
      itemId: undefined,
      validatedData: null,
      nutrition: cherryCokeNutrition,
      isBeverage: true,
    });
    expect(source.basis).toEqual({ kind: "unknown" });
    expect(source.values).toEqual({});
  });

  it("saved-item path bands from `nutrition`, which no control can scale there", () => {
    // Amy's chili: 680 mg sodium per 236 g serving = 288 mg/100 g -> MEDIUM.
    const source = selectBandSource({
      itemId: 42,
      validatedData: null,
      nutrition: {
        productName: "Amy's Organic Chili",
        servingSize: "1 cup (236g)",
        sodium: 680,
      },
      isBeverage: null,
    });
    expect(source.basis).toEqual({
      kind: "resolved",
      scale: "food",
      factor: 100 / 236,
    });
    expect(source.values.sodium).toBe(680);
  });

  it("bands Amy's chili MEDIUM, not HIGH", () => {
    const { rows } = buildPanelRows({
      itemId: 42,
      validatedData: null,
      nutrition: {
        productName: "Amy's Organic Chili",
        servingSize: "1 cup (236g)",
        sodium: 680,
      },
      isBeverage: null,
    });
    const sodium = rows.find((r) => r.row.key === "sodium");
    expect(sodium?.band).toEqual({ group: "concern", band: "medium" });
  });

  it("holds a good per-100 payload and STILL renders unbanded when no scale resolves", () => {
    // The most counterintuitive outcome in the slice, and the one most likely
    // to be "fixed" later by defaulting to food. Food thresholds are roughly
    // DOUBLE drink thresholds, so defaulting halves the strictness applied to
    // every untagged drink. Unbanded is the correct answer.
    const { rows } = buildPanelRows({
      itemId: undefined,
      validatedData: {
        ...cherryCokeValidated,
        servingInfo: {
          displayLabel: "1 bottle",
          grams: null,
          wasCorrected: false,
        },
      },
      nutrition: { ...cherryCokeNutrition, servingSize: "1 bottle" },
      isBeverage: null, // no category signal, and "1 bottle" carries no unit
    });
    const sugar = rows.find((r) => r.row.key === "sugar");
    expect(sugar?.band).toEqual({ group: "concern", band: "unknown" });
    expect(sugar?.hasValue).toBe(true);
  });

  it("saved item with an unparseable serving string renders unbanded, not defaulted", () => {
    const { rows } = buildPanelRows({
      itemId: 42,
      validatedData: null,
      nutrition: {
        productName: "Mystery Drink",
        servingSize: "1 bottle",
        sugar: 39,
      },
      isBeverage: null,
    });
    const sugar = rows.find((r) => r.row.key === "sugar");
    expect(sugar?.band).toEqual({ group: "concern", band: "unknown" });
    expect(sugar?.displayValue).toBe(39);
    expect(sugar?.hasValue).toBe(true);
  });
});

describe("buildPanelRows — the three states that must stay distinct", () => {
  const base = {
    itemId: undefined,
    isBeverage: false,
    validatedData: {
      ...cherryCokeValidated,
      servingInfo: { displayLabel: "30 g", grams: 30, wasCorrected: false },
    } as ValidatedNutrition,
  };

  it("no value at all -> hasValue false, displayValue undefined", () => {
    const { rows } = buildPanelRows({
      ...base,
      validatedData: {
        ...base.validatedData,
        per100g: { sugar: 10 },
      },
      nutrition: { productName: "X", servingSize: "30 g", sugar: 3 },
    });
    const satFat = rows.find((r) => r.row.key === "saturatedFat");
    expect(satFat?.hasValue).toBe(false);
    expect(satFat?.displayValue).toBeUndefined();
  });

  it("a zero value is NOT 'not recorded' — hasValue stays true", () => {
    const { rows } = buildPanelRows({
      ...base,
      validatedData: { ...base.validatedData, per100g: { fiber: 0 } },
      nutrition: { productName: "X", servingSize: "30 g", fiber: 0 },
    });
    const fibre = rows.find((r) => r.row.key === "fibre");
    expect(fibre?.hasValue).toBe(true);
    expect(fibre?.displayValue).toBe(0);
    expect(fibre?.band).toEqual({ group: "benefit", band: "none" });
  });

  it("a known value with an unresolved basis keeps hasValue true and bands unknown", () => {
    const { rows } = buildPanelRows({
      itemId: 42,
      validatedData: null,
      nutrition: { productName: "X", servingSize: "1 bottle", fiber: 5 },
      isBeverage: null,
    });
    const fibre = rows.find((r) => r.row.key === "fibre");
    // Same band as the absent case above, DIFFERENT hasValue. This pair is
    // what pins hasValue to raw-value presence rather than to the band.
    expect(fibre?.band).toEqual({ group: "benefit", band: "unknown" });
    expect(fibre?.hasValue).toBe(true);
  });
});

describe("buildPanelRows — bands feed pickStandouts from the SAME derivation", () => {
  it("emits a NutrientBands object whose hasValue matches the rows'", () => {
    const { rows, bands } = buildPanelRows({
      itemId: undefined,
      validatedData: cherryCokeValidated,
      nutrition: cherryCokeNutrition,
      isBeverage: true,
    });
    for (const row of rows) {
      if (row.row.group === "concern") {
        expect(bands.concerns[row.row.key as "sugar"]?.hasValue).toBe(
          row.hasValue,
        );
      }
    }
  });
});
