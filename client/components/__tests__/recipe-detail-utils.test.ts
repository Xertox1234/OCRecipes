import { describe, it, expect } from "vitest";
import {
  formatTimeDisplay,
  parseNutritionData,
  STEP_TEXT_LINE_HEIGHT,
  toDisplayedDietTags,
  uniqueTagsIgnoringCase,
} from "../recipe-detail/recipe-detail-utils";

describe("toDisplayedDietTags", () => {
  // Checkable diets show only as checked icons (owner ruling 2026-10-17);
  // every other tag stays a text chip.
  it("drops the tags the attribute icons check, keeps the rest", () => {
    expect(
      toDisplayedDietTags(["Vegan", "italian", "Gluten-Free", "keto"]),
    ).toEqual(["italian", "keto"]);
  });

  it("keeps order and drops dairy-free and vegetarian too", () => {
    expect(
      toDisplayedDietTags(["dairy free", "Low-Carb", "vegetarian", "thai"]),
    ).toEqual(["Low-Carb", "thai"]);
  });
});

describe("formatTimeDisplay", () => {
  it("returns null when both times are zero", () => {
    expect(formatTimeDisplay(0, 0)).toBeNull();
  });

  it("returns null when both times are null", () => {
    expect(formatTimeDisplay(null, null)).toBeNull();
  });

  it("returns null when both times are undefined", () => {
    expect(formatTimeDisplay(undefined, undefined)).toBeNull();
  });

  it("formats prep only", () => {
    expect(formatTimeDisplay(30, null)).toBe("30 min prep");
  });

  it("formats cook only", () => {
    expect(formatTimeDisplay(null, 20)).toBe("20 min cook");
  });

  it("formats both prep and cook", () => {
    expect(formatTimeDisplay(15, 25)).toBe("15 min prep · 25 min cook");
  });

  it("treats zero as falsy (same as null)", () => {
    expect(formatTimeDisplay(0, 45)).toBe("45 min cook");
  });
});

describe("parseNutritionData", () => {
  it("returns null when caloriesPerServing is null", () => {
    expect(
      parseNutritionData({
        caloriesPerServing: null,
        proteinPerServing: "20",
      }),
    ).toBeNull();
  });

  it("returns null when caloriesPerServing is undefined", () => {
    expect(parseNutritionData({})).toBeNull();
  });

  it("parses calories only (minimal data)", () => {
    const result = parseNutritionData({ caloriesPerServing: "695.5" });
    expect(result).toEqual({
      calories: 695.5,
      protein: undefined,
      carbs: undefined,
      fat: undefined,
    });
  });

  it("parses all macro fields", () => {
    const result = parseNutritionData({
      caloriesPerServing: "450",
      proteinPerServing: "30.5",
      carbsPerServing: "50",
      fatPerServing: "15.2",
    });
    expect(result).toEqual({
      calories: 450,
      protein: 30.5,
      carbs: 50,
      fat: 15.2,
    });
  });

  it("handles empty string caloriesPerServing as falsy", () => {
    expect(parseNutritionData({ caloriesPerServing: "" })).toBeNull();
  });

  it("parses partial macro data", () => {
    const result = parseNutritionData({
      caloriesPerServing: "200",
      proteinPerServing: "10",
    });
    expect(result).toEqual({
      calories: 200,
      protein: 10,
      carbs: undefined,
      fat: undefined,
    });
  });
});

describe("STEP_TEXT_LINE_HEIGHT", () => {
  // iOS draws a Text into a container exactly its frame's size, and with no
  // numberOfLines the last line that fits is clipped instead of wrapped. Deep
  // in a long scroll the frame comes back a hair short (43.99988 for a
  // 2-line step, measured on the simulator), so a line height whose N-line
  // total sits exactly on the 1/3-pt pixel grid leaves zero slack and drops
  // the last line. Every realistic step must measure a little taller than
  // its lines need.
  const PIXEL = 1 / 3;
  const FLOAT_NOISE = 0.001;

  it.each(Array.from({ length: 40 }, (_, i) => i + 1))(
    "leaves slack above the pixel grid for %i lines",
    (lines) => {
      const needed = lines * STEP_TEXT_LINE_HEIGHT;
      const measured = Math.ceil(needed / PIXEL - 1e-9) * PIXEL;
      expect(measured - needed).toBeGreaterThan(FLOAT_NOISE);
    },
  );

  it("stays visually 20pt", () => {
    expect(Math.abs(STEP_TEXT_LINE_HEIGHT - 20)).toBeLessThan(0.01);
  });
});

describe("uniqueTagsIgnoringCase", () => {
  // Visual QA sweep #34: "Mediterranean" and "mediterranean" showed as two
  // chips. The first spelling the recipe used is the one that stays.
  it("keeps the first spelling of a tag that repeats in another case", () => {
    expect(
      uniqueTagsIgnoringCase([
        "Mediterranean",
        "mediterranean",
        "Vegan",
        "MEDITERRANEAN",
      ]),
    ).toEqual(["Mediterranean", "Vegan"]);
  });

  it("ignores surrounding blanks when comparing", () => {
    expect(uniqueTagsIgnoringCase(["keto", " Keto "])).toEqual(["keto"]);
  });
});
