import { describe, it, expect } from "vitest";
import { formatGroceryAmount } from "../grocery-amount";

describe("formatGroceryAmount", () => {
  it("formats the spec's examples", () => {
    expect(formatGroceryAmount({ quantity: "2", unit: "L" })).toBe("2 L");
    expect(formatGroceryAmount({ quantity: "500", unit: "g", count: 2 })).toBe(
      "2 × 500 g",
    );
    expect(formatGroceryAmount({ quantity: "3", unit: "can" })).toBe("3 cans");
    expect(formatGroceryAmount({ quantity: "12", unit: null })).toBe("12");
  });

  it("returns null when there is no amount", () => {
    expect(formatGroceryAmount({ quantity: null, unit: null })).toBeNull();
    expect(formatGroceryAmount({ quantity: null, unit: "can" })).toBeNull();
    expect(formatGroceryAmount({ quantity: "", unit: null })).toBeNull();
    expect(formatGroceryAmount({ quantity: "abc", unit: null })).toBeNull();
    expect(formatGroceryAmount({ quantity: "0", unit: "g" })).toBeNull();
  });

  it("drops the database's trailing zeros and accepts numbers", () => {
    expect(formatGroceryAmount({ quantity: "2.00", unit: "L" })).toBe("2 L");
    expect(formatGroceryAmount({ quantity: "1.50", unit: "kg" })).toBe(
      "1.5 kg",
    );
    expect(formatGroceryAmount({ quantity: 0.5, unit: "kg" })).toBe("0.5 kg");
  });

  it("makes the parser's counted units plural, and one of them singular", () => {
    const plurals: [string, string][] = [
      ["cup", "cups"],
      ["can", "cans"],
      ["pack", "packs"],
      ["jar", "jars"],
      ["bottle", "bottles"],
      ["bunch", "bunches"],
      ["loaf", "loaves"],
      ["bag", "bags"],
      ["box", "boxes"],
    ];
    for (const [one, many] of plurals) {
      expect(formatGroceryAmount({ quantity: "1", unit: one })).toBe(
        `1 ${one}`,
      );
      expect(formatGroceryAmount({ quantity: "2", unit: one })).toBe(
        `2 ${many}`,
      );
      expect(formatGroceryAmount({ quantity: "0.5", unit: one })).toBe(
        `0.5 ${many}`,
      );
    }
  });

  it("passes any other stored unit through unchanged", () => {
    // Generated lists carry whatever the recipe wrote.
    expect(formatGroceryAmount({ quantity: "2", unit: "cloves" })).toBe(
      "2 cloves",
    );
    expect(formatGroceryAmount({ quantity: "1.5", unit: "tbsp" })).toBe(
      "1.5 tbsp",
    );
    expect(formatGroceryAmount({ quantity: "2", unit: "Cans" })).toBe("2 Cans");
    expect(formatGroceryAmount({ quantity: "2", unit: "cups" })).toBe("2 cups");
  });

  it("shows the multiplier only on a measured unit", () => {
    expect(formatGroceryAmount({ quantity: "2", unit: "L", count: 1 })).toBe(
      "2 L",
    );
    expect(formatGroceryAmount({ quantity: "2", unit: "L", count: 3 })).toBe(
      "3 × 2 L",
    );
    expect(formatGroceryAmount({ quantity: "2", unit: "can", count: 3 })).toBe(
      "2 cans",
    );
  });
});
