import { describe, it, expect } from "vitest";
import {
  FSA_FOOD,
  FSA_DRINK,
  FSA_PORTION_FOOD,
  FSA_PORTION_DRINK,
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

  it("pins the per-portion food table, trigger included", () => {
    expect(FSA_PORTION_FOOD).toEqual({
      triggerGrams: 100,
      lines: { sugar: 27, saturatedFat: 6, sodium: 720 },
    });
  });

  it("pins the per-portion drink table, trigger included", () => {
    // Roughly half the food lines, at a LARGER trigger. The trigger is the
    // half that has no analogue in the per-100 tables and so has no second
    // pin anywhere else — a wrong 100 here is invisible downstream except on
    // portions between 100 and 150 ml.
    expect(FSA_PORTION_DRINK).toEqual({
      triggerGrams: 150,
      lines: { sugar: 13.5, saturatedFat: 3, sodium: 360 },
    });
  });

  it("keeps both portion tables red-only and fat-free", () => {
    // No `low` key on either: the FSA publishes no green band per portion.
    // No `fat` key on either: the figures exist (>21 g / >10.5 g) but no
    // total-fat flag consumes them, and a dead key invites a consumer.
    expect("fat" in FSA_PORTION_FOOD.lines).toBe(false);
    expect("fat" in FSA_PORTION_DRINK.lines).toBe(false);
  });

  it("holds every portion line at exactly 1.2x its per-100 counterpart", () => {
    // A SECOND, INDEPENDENT PIN on the portion figures, which otherwise have
    // none: the literal `toEqual` pins above were transcribed from the same
    // reading of the FSA guidance as the implementation, so a mis-transcribed
    // number would be wrong on both sides and green forever.
    //
    // The ratio is not a coincidence to be "simplified" into a derivation. The
    // FSA publishes both tables as independent figures; that they land on a
    // uniform 1.2x is a property to CHECK, not a rule to compute from — a
    // future edition could revise one line without the other, and this test
    // going red is the correct outcome if it does.
    const RATIO = 1.2;
    const pairs: [number | undefined, number, string][] = [
      [FSA_PORTION_FOOD.lines.sugar, FSA_FOOD.sugar.high, "food sugar"],
      [
        FSA_PORTION_FOOD.lines.saturatedFat,
        FSA_FOOD.saturatedFat.high,
        "food saturatedFat",
      ],
      [FSA_PORTION_FOOD.lines.sodium, FSA_FOOD.sodium.high, "food sodium"],
      [FSA_PORTION_DRINK.lines.sugar, FSA_DRINK.sugar.high, "drink sugar"],
      [
        FSA_PORTION_DRINK.lines.saturatedFat,
        FSA_DRINK.saturatedFat.high,
        "drink saturatedFat",
      ],
      [FSA_PORTION_DRINK.lines.sodium, FSA_DRINK.sodium.high, "drink sodium"],
    ];
    expect(pairs).toHaveLength(6); // all three nutrients on both scales
    for (const [portionLine, per100High, label] of pairs) {
      expect(portionLine, label).toBeDefined();
      expect(portionLine! / per100High, label).toBeCloseTo(RATIO, 10);
    }
  });

  it("keeps every drink portion line ABOVE its per-100ml counterpart", () => {
    // The headroom `concernBand` relies on: a value big enough to trip the
    // portion line has already tripped the per-100 line whenever the portion
    // is no larger than 100 ml, which is what makes the >150 ml trigger the
    // only thing separating the two arms on the drink scale.
    expect(FSA_PORTION_DRINK.lines.sugar).toBeGreaterThan(FSA_DRINK.sugar.high);
    expect(FSA_PORTION_DRINK.lines.saturatedFat).toBeGreaterThan(
      FSA_DRINK.saturatedFat.high,
    );
    expect(FSA_PORTION_DRINK.lines.sodium).toBeGreaterThan(
      FSA_DRINK.sodium.high,
    );
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
