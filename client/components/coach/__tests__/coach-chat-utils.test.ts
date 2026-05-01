import { describe, it, expect } from "vitest";
import {
  parsePlanDays,
  planBannerA11yLabel,
  stripCoachBlocksFence,
  filterValidBlocks,
} from "../coach-chat-utils";

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

describe("stripCoachBlocksFence", () => {
  it("returns trimmed text when no fence present", () => {
    expect(stripCoachBlocksFence("  hello world  ")).toBe("hello world");
  });

  it("strips fence when only fence present (no preceding text)", () => {
    const input = '```coach_blocks\n{"type":"action_card"}\n```';
    expect(stripCoachBlocksFence(input)).toBe("");
  });

  it("preserves text before the fence and strips fence block", () => {
    const input =
      'Here is your plan.\n```coach_blocks\n{"type":"action_card"}\n```';
    expect(stripCoachBlocksFence(input)).toBe("Here is your plan.");
  });

  it("strips up to end of string when closing fence not yet arrived", () => {
    const input = 'Some text.\n```coach_blocks\n{"type":"action';
    expect(stripCoachBlocksFence(input)).toBe("Some text.");
  });

  it("handles text after closing fence", () => {
    const input = "Before.\n```coach_blocks\n{}\n```\nAfter.";
    expect(stripCoachBlocksFence(input)).toBe("Before.\nAfter.");
  });
});

describe("filterValidBlocks", () => {
  it("returns only items matching coachBlockSchema", () => {
    const valid = {
      type: "action_card" as const,
      title: "Log Lunch",
      subtitle: "Quick meal entry",
      actionLabel: "Log it",
      action: {
        type: "log_food" as const,
        description: "Chicken salad",
        calories: 350,
        protein: 35,
        fat: 12,
        carbs: 25,
      },
    };
    const invalid = { type: "unknown_block", garbage: true };
    const result = filterValidBlocks([valid, invalid, null, 42]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "action_card" });
  });

  it("returns empty array when nothing passes validation", () => {
    expect(filterValidBlocks([null, undefined, {}, { type: "bad" }])).toEqual(
      [],
    );
  });
});
