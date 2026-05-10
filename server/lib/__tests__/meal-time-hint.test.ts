import { describe, it, expect } from "vitest";
import { inferMealTimeHint } from "../meal-time-hint";

describe("inferMealTimeHint", () => {
  it("hour 0 → snack", () => {
    expect(inferMealTimeHint(0)).toBe("snack");
  });

  it("hour 5 → snack (before breakfast window)", () => {
    expect(inferMealTimeHint(5)).toBe("snack");
  });

  it("hour 6 → breakfast (start of breakfast window)", () => {
    expect(inferMealTimeHint(6)).toBe("breakfast");
  });

  it("hour 10 → breakfast (end of breakfast window)", () => {
    expect(inferMealTimeHint(10)).toBe("breakfast");
  });

  it("hour 11 → lunch (start of lunch window)", () => {
    expect(inferMealTimeHint(11)).toBe("lunch");
  });

  it("hour 13 → lunch (within lunch window)", () => {
    expect(inferMealTimeHint(13)).toBe("lunch");
  });

  it("hour 14 → snack (14 is NOT lunch — boundary)", () => {
    expect(inferMealTimeHint(14)).toBe("snack");
  });

  it("hour 15 → snack (afternoon gap between lunch and dinner windows)", () => {
    // Intentional: 14-16 are snack hours, not lunch or dinner
    expect(inferMealTimeHint(15)).toBe("snack");
  });

  it("hour 17 → dinner (start of dinner window)", () => {
    expect(inferMealTimeHint(17)).toBe("dinner");
  });

  it("hour 20 → dinner (end of dinner window)", () => {
    expect(inferMealTimeHint(20)).toBe("dinner");
  });

  it("hour 21 → snack (21 is NOT dinner — boundary)", () => {
    expect(inferMealTimeHint(21)).toBe("snack");
  });

  it("hour 23 → snack (late night)", () => {
    expect(inferMealTimeHint(23)).toBe("snack");
  });
});
