import { describe, it, expect } from "vitest";
import {
  FSA_FOOD,
  FSA_DRINK,
  FSA_PORTION,
  FIBRE_CLAIM,
  PROTEIN_ENERGY_CLAIM,
  BEVERAGE_PARENT,
  isBeverageCategory,
} from "../nutrition-bands";

// These are LITERAL pins, deliberately. A downstream behaviour test cannot
// catch a transposed threshold that stays inside its own band's interval —
// the existing universal-flags suite pins food sugar only outside (12, 30).
describe("FSA concern thresholds", () => {
  it("pins the per-100g food bands", () => {
    expect(FSA_FOOD).toEqual({
      sugar: { low: 5.0, high: 22.5 },
      saturatedFat: { low: 1.5, high: 5.0 },
      fat: { low: 3.0, high: 17.5 },
      sodium: { low: 120, high: 600 },
    });
  });

  it("pins the per-100ml drink bands", () => {
    expect(FSA_DRINK).toEqual({
      sugar: { low: 2.5, high: 11.25 },
      saturatedFat: { low: 0.75, high: 2.5 },
      fat: { low: 1.5, high: 8.75 },
      sodium: { low: 120, high: 300 },
    });
  });

  it("keeps sodium LOW identical on both bases", () => {
    // FSA salt LOW is 0.3 g/100 for food AND drink; only HIGH differs
    // (1.5 g vs 0.75 g). Not a copy-paste slip — do not "fix" it.
    expect(FSA_DRINK.sodium.low).toBe(FSA_FOOD.sodium.low);
    expect(FSA_DRINK.sodium.high).not.toBe(FSA_FOOD.sodium.high);
  });

  it("keeps FSA_PORTION red-only and fat-free", () => {
    expect(FSA_PORTION).toEqual({ sugar: 27, saturatedFat: 6, sodium: 720 });
    expect("fat" in FSA_PORTION).toBe(false);
  });

  it("preserves the shipped HIGH values exactly", () => {
    // These three moved from server/services/nutrition-flag-rules.ts and
    // must not drift — they decide live flag emission.
    expect(FSA_FOOD.sugar.high).toBe(22.5);
    expect(FSA_FOOD.saturatedFat.high).toBe(5.0);
    expect(FSA_FOOD.sodium.high).toBe(600);
    expect(FSA_DRINK.sugar.high).toBe(11.25);
    expect(FSA_DRINK.saturatedFat.high).toBe(2.5);
    expect(FSA_DRINK.sodium.high).toBe(300);
  });
});

describe("benefit claim thresholds", () => {
  it("pins EU 1924/2006 fibre thresholds per 100g", () => {
    expect(FIBRE_CLAIM).toEqual({ good: 3, excellent: 6 });
  });

  it("pins protein claims as a fraction of energy", () => {
    expect(PROTEIN_ENERGY_CLAIM).toEqual({ good: 0.12, excellent: 0.2 });
  });
});

describe("isBeverageCategory", () => {
  it("matches on the parent tag", () => {
    expect(isBeverageCategory(["en:beverages", "en:colas"])).toBe(true);
  });

  it("tolerates polluted leaf tags without the parent", () => {
    expect(isBeverageCategory(["en:carbonated-drinks"])).toBe(false);
  });

  it("returns false for an empty tag list", () => {
    expect(isBeverageCategory([])).toBe(false);
  });

  it("exports the parent tag it matches on", () => {
    expect(BEVERAGE_PARENT).toBe("en:beverages");
  });
});
