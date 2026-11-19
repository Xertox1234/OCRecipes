import { describe, it, expect } from "vitest";
import {
  addGroceryCardArgsSchema,
  addMealPlanCardArgsSchema,
  logFoodCardArgsSchema,
} from "../tool-args";

// The model writes this text and the card shows and saves it, without it ever
// passing through the reply's output screen (audit 2026-11-12).
const UNSAFE = "Dry fast";

const food = (over: Record<string, unknown> = {}) => ({
  items: [
    {
      name: "Large eggs",
      count: 2,
      unitLabel: "egg",
      estimate: { calories: 72, protein: 6, carbs: 0, fat: 5 },
      ...over,
    },
  ],
});

const grocery = (
  item: Record<string, unknown> = {},
  rest: Record<string, unknown> = {},
) => ({
  items: [{ name: "Spinach", quantity: "1", unit: "bag", ...item }],
  ...rest,
});

describe("write-card tool arguments", () => {
  it("accepts ordinary card text (control)", () => {
    expect(logFoodCardArgsSchema.safeParse(food()).success).toBe(true);
    expect(
      addGroceryCardArgsSchema.safeParse(grocery({}, { listName: "Weekend" }))
        .success,
    ).toBe(true);
  });

  it.each(["name", "unitLabel"])(
    "refuses a food card whose %s holds unsafe advice",
    (field) => {
      expect(
        logFoodCardArgsSchema.safeParse(food({ [field]: UNSAFE })).success,
      ).toBe(false);
    },
  );

  it.each(["name", "quantity", "unit"])(
    "refuses a grocery card whose item %s holds unsafe advice",
    (field) => {
      expect(
        addGroceryCardArgsSchema.safeParse(grocery({ [field]: UNSAFE }))
          .success,
      ).toBe(false);
    },
  );

  it("refuses a grocery card whose list name holds unsafe advice", () => {
    expect(
      addGroceryCardArgsSchema.safeParse(grocery({}, { listName: UNSAFE }))
        .success,
    ).toBe(false);
  });
});

// L-xc-4: a regex alone let "2026-02-30" through; Postgres then rejected the
// date after the model had already said the card was shown.
describe("meal plan card plannedDate", () => {
  const plan = (plannedDate: string) => ({
    rows: [
      {
        plannedDate,
        mealType: "dinner",
        recipe: { source: "community", id: 1 },
      },
    ],
  });
  it("accepts a real date (control)", () => {
    expect(
      addMealPlanCardArgsSchema.safeParse(plan("2026-02-28")).success,
    ).toBe(true);
  });
  it.each(["2026-02-30", "2026-13-45", "2026-00-10"])("rejects %s", (date) => {
    expect(addMealPlanCardArgsSchema.safeParse(plan(date)).success).toBe(false);
  });
});
