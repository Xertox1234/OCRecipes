import { describe, it, expect } from "vitest";
import { parsePlanDays, planBannerA11yLabel } from "../coach-chat-utils";

const validDays = [
  {
    label: "Monday",
    meals: [
      {
        type: "breakfast" as const,
        title: "Oatmeal",
        calories: 350,
        protein: 12,
      },
      {
        type: "lunch" as const,
        title: "Grilled Chicken Salad",
        calories: 480,
        protein: 38,
      },
      {
        type: "dinner" as const,
        title: "Salmon Bowl",
        calories: 550,
        protein: 42,
      },
    ],
    totals: { calories: 1380, protein: 92 },
  },
  {
    label: "Tuesday",
    meals: [
      {
        type: "breakfast" as const,
        title: "Smoothie",
        calories: 280,
        protein: 20,
      },
    ],
    totals: { calories: 280, protein: 20 },
  },
];

describe("parsePlanDays", () => {
  it("returns typed days from valid plan data", () => {
    const result = parsePlanDays(validDays);
    expect(result).toHaveLength(2);
    expect(result![0].label).toBe("Monday");
    expect(result![0].meals).toHaveLength(3);
    expect(result![1].meals[0].title).toBe("Smoothie");
  });

  it("returns undefined for non-array input", () => {
    expect(parsePlanDays("not an array")).toBeUndefined();
    expect(parsePlanDays(42)).toBeUndefined();
    expect(parsePlanDays(null)).toBeUndefined();
    expect(parsePlanDays(undefined)).toBeUndefined();
  });

  it("returns undefined for array with invalid shape", () => {
    expect(parsePlanDays([{ wrong: "shape" }])).toBeUndefined();
    expect(parsePlanDays([{ label: "Monday" }])).toBeUndefined();
  });

  it("returns undefined for missing required fields in meals", () => {
    const missingCalories = [
      {
        label: "Monday",
        meals: [{ type: "breakfast", title: "Oatmeal", protein: 12 }],
        totals: { calories: 350, protein: 12 },
      },
    ];
    expect(parsePlanDays(missingCalories)).toBeUndefined();
  });

  it("returns undefined for invalid meal type enum", () => {
    const badMealType = [
      {
        label: "Monday",
        meals: [{ type: "brunch", title: "Eggs", calories: 300, protein: 20 }],
        totals: { calories: 300, protein: 20 },
      },
    ];
    expect(parsePlanDays(badMealType)).toBeUndefined();
  });

  it("returns empty array for empty input array", () => {
    expect(parsePlanDays([])).toEqual([]);
  });
});

describe("planBannerA11yLabel", () => {
  it("pluralizes days and meals correctly", () => {
    expect(planBannerA11yLabel(validDays)).toBe(
      "AI meal plan with 2 days and 4 meals",
    );
  });

  it("uses singular for 1 day", () => {
    const oneDay = [validDays[1]];
    expect(planBannerA11yLabel(oneDay)).toBe(
      "AI meal plan with 1 day and 1 meal",
    );
  });

  it("handles day with no meals", () => {
    const emptyDay = [
      { label: "Rest Day", meals: [], totals: { calories: 0, protein: 0 } },
    ];
    expect(planBannerA11yLabel(emptyDay)).toBe(
      "AI meal plan with 1 day and 0 meals",
    );
  });
});
