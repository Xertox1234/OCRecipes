import { describe, it, expect } from "vitest";
import { labelFitsProduct } from "../label-fit";

describe("labelFitsProduct", () => {
  const cup = { calories: 120, servingSize: "1 cup (240 ml)" }; // 50 per 100 ml

  it("fits a label close to the product per 100 g", () => {
    expect(labelFitsProduct(cup, 46)).toBe(true);
  });

  it("does not fit a label far from the product per 100 g", () => {
    // 360 kcal a cup is 150 per 100 ml against 46.
    expect(labelFitsProduct({ ...cup, calories: 360 }, 46)).toBe(false);
    // And far below: 20 per 100 ml against 300.
    expect(labelFitsProduct({ ...cup, calories: 48 }, 300)).toBe(false);
  });

  it("tolerates near-zero foods whose figures are close in calories", () => {
    // 5 per 100 ml against 2: a big ratio, a tiny difference.
    expect(labelFitsProduct({ ...cup, calories: 12 }, 2)).toBe(true);
    // A zero-calorie record and a label within the floor.
    expect(labelFitsProduct({ ...cup, calories: 0 }, 0)).toBe(true);
    // A zero-calorie record and a real food: another pack.
    expect(labelFitsProduct({ ...cup, calories: 240 }, 0)).toBe(false);
  });

  it("fits when either side gives nothing to compare", () => {
    expect(labelFitsProduct({ ...cup, servingSize: "1 bar" }, 46)).toBe(true);
    expect(labelFitsProduct(cup, undefined)).toBe(true);
  });
});
