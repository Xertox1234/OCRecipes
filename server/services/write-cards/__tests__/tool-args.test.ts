import { describe, it, expect } from "vitest";
import { addGroceryCardArgsSchema, logFoodCardArgsSchema } from "../tool-args";

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
