import { DEFAULT_NUTRITION_GOALS } from "../nutrition";

describe("DEFAULT_NUTRITION_GOALS", () => {
  it("has the expected calorie default", () => {
    expect(DEFAULT_NUTRITION_GOALS.calories).toBe(2000);
  });

  it("has the expected protein default", () => {
    expect(DEFAULT_NUTRITION_GOALS.protein).toBe(150);
  });

  it("has the expected carbs default", () => {
    expect(DEFAULT_NUTRITION_GOALS.carbs).toBe(250);
  });

  it("has the expected fat default", () => {
    expect(DEFAULT_NUTRITION_GOALS.fat).toBe(67);
  });

  it("has exactly four keys", () => {
    expect(Object.keys(DEFAULT_NUTRITION_GOALS)).toHaveLength(4);
  });

  it("values are all positive integers", () => {
    for (const value of Object.values(DEFAULT_NUTRITION_GOALS)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });
});
