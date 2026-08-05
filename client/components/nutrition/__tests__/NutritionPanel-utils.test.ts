import { describe, it, expect } from "vitest";

import {
  NUTRIENT_ROWS,
  bandTagText,
  bandVisuals,
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

/**
 * `bandVisuals` decides a row's DOT COLOUR and its pill icon, and until now had
 * no direct test at all: this suite covered only `bandTagText` /
 * `composeNutrientRowLabel` / `NUTRIENT_ROWS`; `badge-contrast.test.ts` imports
 * the `*_VISUALS` constants directly and never calls this function; and the
 * component suites assert only that the dot testID is present or absent, never
 * which colour or glyph it resolved. So `CONCERN_VISUALS.high =
 * CONCERN_LOW_VISUALS` compiled clean, passed the whole suite, and rendered a
 * HIGH sugar row with a GREEN check-circle dot and a green pill.
 *
 * Asserted as literal token/glyph names rather than `toBe(HIGH_SEVERITY_VISUALS)`
 * — comparing against the same constant the table points at is satisfied by any
 * mis-wiring that happens to reuse a real constant, which is exactly the defect
 * shape above.
 */
describe("bandVisuals", () => {
  it("maps every concern band to its own token and glyph", () => {
    expect(bandVisuals({ group: "concern", band: "high" })).toEqual({
      colorKey: "badgeErrorText",
      icon: "alert-triangle",
    });
    expect(bandVisuals({ group: "concern", band: "medium" })).toEqual({
      colorKey: "badgeWarningText",
      icon: "alert-circle",
    });
    // Green, and deliberately NOT the benefit glyph — the two share
    // `badgeSuccessText`, so the icon is the channel that keeps "a good result
    // about a bad thing" distinct from "actively good news".
    expect(bandVisuals({ group: "concern", band: "low" })).toEqual({
      colorKey: "badgeSuccessText",
      icon: "check-circle",
    });
  });

  it("maps every benefit band to its own token and glyph", () => {
    expect(bandVisuals({ group: "benefit", band: "excellent" })).toEqual({
      colorKey: "badgeSuccessText",
      icon: "award",
    });
    expect(bandVisuals({ group: "benefit", band: "good" })).toEqual({
      colorKey: "badgeSuccessText",
      icon: "award",
    });
    // Grey, not green: a product with no fibre is a fact about the product.
    expect(bandVisuals({ group: "benefit", band: "none" })).toEqual({
      colorKey: "badgeNeutralText",
      icon: "minus-circle",
    });
  });

  it("returns null for BOTH unknown bands — no dot, no pill", () => {
    expect(bandVisuals({ group: "concern", band: "unknown" })).toBeNull();
    expect(bandVisuals({ group: "benefit", band: "unknown" })).toBeNull();
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
