import { describe, it, expect } from "vitest";

import { selectBandSource, buildPanelRows } from "../nutrition-band-source";
import { pickStandouts } from "@shared/lib/nutrition-bands";
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

  it("bands Cherry Coke HIGH via the drink per-portion override", () => {
    // 11.0 g/100 ml is MEDIUM on the per-100 drink scale — the portion arm is
    // what makes this red: 355 ml holds 39 g, over the FSA drink portion line
    // of 13.5, at a portion over the 150 ml trigger.
    //
    // The portion weight comes from `validatedData.servingInfo.grams`, which
    // the serving controls never rewrite — that is what lets the panel apply
    // an override the module once had to skip.
    const { rows } = buildPanelRows({
      itemId: undefined,
      validatedData: cherryCokeValidated,
      nutrition: cherryCokeNutrition,
      isBeverage: true,
    });
    const sugar = rows.find((r) => r.row.key === "sugar");
    expect(sugar?.band).toEqual({ group: "concern", band: "high" });
  });

  it("keeps that band at quantity 2, while the DISPLAYED value doubles", () => {
    // The invariance claim, now with the override live — which makes it a
    // stronger statement than before, not a weaker one: the override is the
    // one part of banding that takes a WEIGHT, so if any serving choice could
    // move a band it would move it here.
    const doubled: NutritionData = { ...cherryCokeNutrition, sugar: 78 };
    const { rows } = buildPanelRows({
      itemId: undefined,
      validatedData: cherryCokeValidated,
      nutrition: doubled,
      isBeverage: true,
    });
    const sugar = rows.find((r) => r.row.key === "sugar");
    expect(sugar?.band).toEqual({ group: "concern", band: "high" });
    expect(sugar?.displayValue).toBe(78);
  });

  it("saved-item path APPLIES the override when a real portion crosses it", () => {
    // The positive case for the saved-item branch, which nothing else covers:
    // every other saved-item test lands under a portion line and so only ever
    // proves the override does NOT fire. 28 g of sugar in a 700 g serving is
    // 4 g/100 g — LOW on its own — so the per-100 arm cannot produce this
    // verdict and only the portion arm can (28 > 27, 700 > 100).
    const { rows } = buildPanelRows({
      itemId: 42,
      validatedData: null,
      nutrition: {
        productName: "Big tub",
        servingSize: "700 g",
        calories: 500,
        sugar: 28,
      },
      isBeverage: false,
    });
    const sugar = rows.find((r) => r.row.key === "sugar");
    expect(sugar?.band).toEqual({ group: "concern", band: "high" });
  });

  it("saved-item path stays unbanded on an ESTIMATED serving string", () => {
    // The module docblock calls this "fragile" and nothing pinned it. A
    // corrected serving is stored as `~355g (estimated)`; `parseServingBasis`
    // returns null for it (the `~` defeats its token anchor), so the basis is
    // unknown and NOTHING bands — which is the only thing stopping the saved
    // item path from banding off an invented denominator. If a future edit
    // widens the parser's leading-character tolerance, this goes red.
    const { rows } = buildPanelRows({
      itemId: 42,
      validatedData: null,
      nutrition: {
        productName: "Corrected serving",
        servingSize: "~355g (estimated)",
        calories: 156,
        sugar: 39,
      },
      isBeverage: true,
    });
    const sugar = rows.find((r) => r.row.key === "sugar");
    expect(sugar?.band).toEqual({ group: "concern", band: "unknown" });
    // Non-vacuity: the same numbers with a PARSEABLE serving do band, so the
    // `unknown` above is the parser refusing the string, not an absent value.
    const parseable = buildPanelRows({
      itemId: 42,
      validatedData: null,
      nutrition: {
        productName: "Same numbers",
        servingSize: "355 ml",
        calories: 156,
        sugar: 39,
      },
      isBeverage: true,
    });
    expect(parseable.rows.find((r) => r.row.key === "sugar")?.band).not.toEqual(
      { group: "concern", band: "unknown" },
    );
  });

  it("skips the override when the serving was ESTIMATED, mirroring the server", () => {
    // `isServingDataTrusted: false` is how the server decides not to pass
    // `perServing` to `evaluateUniversalFlags` at all. The panel must not
    // escalate off a portion weight the server refused to trust, or the two
    // disagree on screen in the over-warning direction.
    const { rows } = buildPanelRows({
      itemId: undefined,
      validatedData: { ...cherryCokeValidated, isServingDataTrusted: false },
      nutrition: cherryCokeNutrition,
      isBeverage: true,
    });
    const sugar = rows.find((r) => r.row.key === "sugar");
    expect(sugar?.band).toEqual({ group: "concern", band: "medium" });
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

  it("bands a label scan's saved item the SAME whether servingsConsumed was 1 or 3 (regression, todo P2-2026-08-13)", () => {
    // The confirm-label route no longer scales macros by servingsConsumed
    // before writing — the scanned item stores unscaled per-serving values
    // that match its OWN servingSize. 10 g of sugar in a 150 g serving is
    // 6.67 g/100 g (MEDIUM on the per-100 food scale: over the 5.0 low line,
    // under the 22.5 high line) and well under the 27 g per-portion RED
    // line, so no override fires and the band stays MEDIUM. Before the fix,
    // servingsConsumed = 3 would have written 30 g (10 x 3) against the SAME
    // "150 g" label — crossing the portion line and producing a false
    // "High in sugar" (see the todo's Background table). Pinning the exact
    // MEDIUM band, not just "not high", so this can't pass vacuously if the
    // row stops banding at all.
    const { rows } = buildPanelRows({
      itemId: 42,
      validatedData: null,
      nutrition: {
        productName: "Trail Mix",
        servingSize: "150 g",
        calories: 200,
        sugar: 10,
      },
      isBeverage: null,
    });
    const sugar = rows.find((r) => r.row.key === "sugar");
    expect(sugar?.band).toEqual({ group: "concern", band: "medium" });
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

describe("buildPanelRows — the direct-OFF fallback's ASYMMETRIC sources", () => {
  /**
   * `hasValue` reads the BAND source (`validatedData.per100g`) while
   * `displayValue` reads the DISPLAY source (`nutrition`). On the primary
   * server path those two are symmetric by construction —
   * `barcode-lookup.ts` computes `perServing = scaleNutrients(per100g, scale)`
   * and `label-override.ts` merges both halves — so the gap below cannot open
   * there. On the CLIENT-SIDE direct-OFF fallback (server unreachable or 5xx)
   * it can:
   *
   *   - `validateAndNormalizeNutrition`'s trusted branch returns
   *     `perServing: existingPerServing` (serving-size-utils.ts:362-374), an
   *     object built field-by-field from independently-present OFF `*_serving`
   *     fields (:334-349), while `per100g` is built from the separate `*_100g`
   *     fields (:296-307).
   *   - The plausibility gate that admits that branch inspects CALORIES ONLY
   *     (:351) — `checkServingPlausibility` never looks at sugar, fat or
   *     sodium.
   *   - `useNutritionLookup.ts:652` then copies `validated.perServing` into
   *     `nutrition` field by field.
   *
   * So the common OFF shape "`sugars_100g` present, `sugars_serving` absent,
   * `energy-kcal_serving` present and plausible" yields
   * `validatedData.per100g.sugar = 11.0` alongside `nutrition.sugar =
   * undefined`, and the panel and the summary card end up describing the same
   * nutrient in contradictory terms.
   */
  const divergentValidated: ValidatedNutrition = {
    // `sugars_100g` and `fiber_100g` are carried by the record...
    per100g: { calories: 44, sugar: 11.0, fiber: 4 },
    // ...but only `energy-kcal_serving` has a per-serving counterpart, and
    // calories alone is what the plausibility gate checks.
    perServing: { calories: 156 },
    servingInfo: {
      displayLabel: "1 can (355 mL)",
      grams: 355,
      wasCorrected: false,
    },
    isServingDataTrusted: true,
  };

  const divergentNutrition: NutritionData = {
    productName: "Fallback Cola",
    servingSize: "1 can (355 mL)",
    calories: 156,
  };

  const divergentInput = {
    itemId: undefined,
    validatedData: divergentValidated,
    nutrition: divergentNutrition,
    isBeverage: true,
  };

  it("publishes no band for a nutrient the panel renders as 'Not recorded'", () => {
    const { rows } = buildPanelRows(divergentInput);
    const sugar = rows.find((r) => r.row.key === "sugar");

    // The panel gates its dot, its pill and its value cell on `displayValue`,
    // so this row reads "Sugar — Not recorded" with no indicator...
    expect(sugar?.displayValue).toBeUndefined();
    // ...and `hasValue`/`band` must now say the same thing. Before the fix
    // this row carried `hasValue: true` and a live MEDIUM band (11.0 sits
    // between FSA_DRINK.sugar.low 2.5 and .high 11.25).
    expect(sugar?.hasValue).toBe(false);
    expect(sugar?.band).toEqual({ group: "concern", band: "unknown" });
  });

  it("promotes no standout for a nutrient the panel cannot display", () => {
    const { bands } = buildPanelRows(divergentInput);

    expect(bands.concerns.sugar).toEqual({ band: "unknown", hasValue: false });

    // The user-visible defect: `pickStandouts`' rule 3 qualifies on the BAND,
    // so a MEDIUM sugar band rendered "Moderate sugar" with a coloured pill on
    // the summary card for the very nutrient the panel below it reported as
    // not recorded.
    //
    // Fibre goes quiet too, and that is correct rather than incidental: its
    // 4 g/100 g cleared FIBRE_CLAIM.good, so rule 3 promoted "Good source of
    // fibre" off a number the screen never shows. With `hasValue` false,
    // rule 3's band gate and rule 5's `fibre?.hasValue` gate both decline —
    // saying nothing, rather than claiming a benefit we cannot display.
    expect(pickStandouts(bands)).toEqual([]);
  });

  it("still bands from the UN-SCALED per-100 value when both sources agree", () => {
    // The gate must not become a second VALUE source: `nutrition` decides
    // whether a band is published, never what it says.
    //
    // The per-100 sugar is dropped to 2.0 here rather than reusing the
    // fixture's 11.0 for a reason. At 11.0 the two readings no longer differ
    // in BAND — 11.0 across a 355 ml can is 39 g, over the drink portion line,
    // and the display value 39 read as a per-100 number is over the per-100
    // line, so both routes land on "high" and the test would pass while
    // proving nothing. At 2.0 they diverge: the correct answer is LOW (2.0 is
    // under the 2.5 drink low line, and 7.1 g in the can is under the 13.5
    // portion line), while a leak from `displayValue` would read 39 g/100 ml
    // and say HIGH.
    const { rows } = buildPanelRows({
      ...divergentInput,
      validatedData: {
        ...divergentValidated,
        per100g: { ...divergentValidated.per100g, sugar: 2.0 },
      },
      nutrition: { ...divergentNutrition, sugar: 39 },
    });
    const sugar = rows.find((r) => r.row.key === "sugar");

    expect(sugar?.hasValue).toBe(true);
    expect(sugar?.displayValue).toBe(39);
    expect(sugar?.band).toEqual({ group: "concern", band: "low" });
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
