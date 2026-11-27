import {
  compareRows,
  compareSpoken,
  servingLine,
} from "../label-compare-utils";
import type { LabelCompareBlock } from "@shared/schemas/coach-blocks";

type Item = LabelCompareBlock["items"][number];
const item = (over: Partial<Item>): Item => ({
  scanId: 1,
  name: "Oat bar",
  brand: null,
  servingSize: "1 bar (40 g)",
  calories: 180,
  protein: 4,
  carbs: 24,
  fat: 7,
  fiber: null,
  sugar: 9.5,
  sodium: 95,
  ...over,
});

describe("compareRows", () => {
  it("lists each nutrient both products have, and skips one neither has", () => {
    const rows = compareRows([
      item({}),
      item({ scanId: 2, name: "Nut bar", sodium: null, fiber: null }),
    ]);
    expect(rows.map((r) => r.label)).toEqual([
      "Calories",
      "Protein",
      "Carbs",
      "Fat",
      "Sugar",
      "Sodium",
    ]);
    expect(rows[0]).toMatchObject({ a: "180", b: "180" });
    expect(rows[4]).toMatchObject({ a: "9.5 g", b: "9.5 g" });
    expect(rows[5]).toMatchObject({ a: "95 mg", b: "—" });
  });
});

describe("servingLine", () => {
  it("names the serving the numbers are for", () => {
    expect(servingLine(item({}))).toBe("per 1 bar (40 g)");
    expect(servingLine(item({ servingSize: null }))).toBe("per serving");
    expect(servingLine(item({ servingSize: "  " }))).toBe("per serving");
  });
});

describe("compareSpoken", () => {
  it("speaks both products, their servings, and every row", () => {
    const a = item({ protein: 4, carbs: null, fat: null, sugar: null });
    const b = item({
      scanId: 2,
      name: "Nut bar",
      brand: "Acme",
      servingSize: null,
      calories: 190,
      protein: 6,
      carbs: null,
      fat: null,
      sugar: null,
      sodium: null,
    });
    expect(compareSpoken([a, b])).toBe(
      "Comparing Oat bar, per 1 bar (40 g), and Nut bar by Acme, per serving. Calories: 180 for Oat bar, 190 for Nut bar. Protein: 4 grams for Oat bar, 6 grams for Nut bar. Sodium: 95 milligrams for Oat bar, not listed for Nut bar",
    );
  });
});
