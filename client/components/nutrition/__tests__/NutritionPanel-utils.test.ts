import { describe, it, expect } from "vitest";

import {
  NUTRIENT_ROWS,
  bandTagText,
  composeNutrientRowLabel,
} from "../NutritionPanel-utils";

describe("bandTagText", () => {
  it("uses the exact spec copy for every concern band", () => {
    expect(bandTagText({ group: "concern", band: "high" })).toBe("HIGH");
    expect(bandTagText({ group: "concern", band: "medium" })).toBe("MED");
    expect(bandTagText({ group: "concern", band: "low" })).toBe("LOW");
  });

  it("uses the exact spec copy for every benefit band", () => {
    expect(bandTagText({ group: "benefit", band: "excellent" })).toBe(
      "EXCELLENT",
    );
    expect(bandTagText({ group: "benefit", band: "good" })).toBe("GOOD");
    expect(bandTagText({ group: "benefit", band: "none" })).toBe("NONE");
  });

  it("returns null for an unknown band — an unbanded row shows no tag at all", () => {
    expect(bandTagText({ group: "concern", band: "unknown" })).toBeNull();
    expect(bandTagText({ group: "benefit", band: "unknown" })).toBeNull();
  });
});

describe("composeNutrientRowLabel", () => {
  it("spells the unit out as a word — VoiceOver reads a bare 'g' as 'gee'", () => {
    expect(
      composeNutrientRowLabel({
        row: NUTRIENT_ROWS.sugar,
        value: 39,
        tag: "HIGH",
      }),
    ).toBe("Sugar, 39 grams, high");
  });

  it("spells milligrams out too", () => {
    expect(
      composeNutrientRowLabel({
        row: NUTRIENT_ROWS.sodium,
        value: 680,
        tag: "MED",
      }),
    ).toBe("Sodium, 680 milligrams, medium");
  });

  it("composes without a band word when the row is unbanded", () => {
    expect(
      composeNutrientRowLabel({
        row: NUTRIENT_ROWS.sugar,
        value: 39,
        tag: null,
      }),
    ).toBe("Sugar, 39 grams");
  });

  it("says 'not recorded' when there is no value, and never says zero", () => {
    expect(
      composeNutrientRowLabel({
        row: NUTRIENT_ROWS.saturatedFat,
        value: undefined,
        tag: null,
      }),
    ).toBe("Saturated fat, not recorded");
  });

  it("keeps a zero value distinct from not recorded", () => {
    expect(
      composeNutrientRowLabel({
        row: NUTRIENT_ROWS.fibre,
        value: 0,
        tag: "NONE",
      }),
    ).toBe("Fibre, 0 grams, none");
  });

  it("rounds to one decimal, matching the rendered value", () => {
    expect(
      composeNutrientRowLabel({
        row: NUTRIENT_ROWS.sugar,
        value: 12.34,
        tag: "MED",
      }),
    ).toBe("Sugar, 12.3 grams, medium");
  });
});

describe("NUTRIENT_ROWS", () => {
  it("covers every nutrient the panel renders, in the two zones", () => {
    const banded = Object.values(NUTRIENT_ROWS).filter(
      (r) => r.zone === "banded",
    );
    const unbanded = Object.values(NUTRIENT_ROWS).filter(
      (r) => r.zone === "unbanded",
    );
    expect(banded.map((r) => r.key).sort()).toEqual([
      "fat",
      "fibre",
      "protein",
      "saturatedFat",
      "sodium",
      "sugar",
    ]);
    expect(unbanded.map((r) => r.key).sort()).toEqual([
      "caffeine",
      "cholesterol",
      "transFat",
    ]);
  });

  it("maps fibre's row to NutritionData's US spelling — 'fiber', not 'fibre'", () => {
    // The band layer says `fibre` (BenefitNutrient); NutritionData and
    // NutritionPer100g both say `fiber`. A typo here is silently `undefined`,
    // which renders as "Not recorded" on every product — a failure that looks
    // like missing data rather than a bug.
    expect(NUTRIENT_ROWS.fibre.sourceKey).toBe("fiber");
  });
});
