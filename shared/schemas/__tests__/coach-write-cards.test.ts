import { describe, it, expect } from "vitest";
import {
  foodEditsSchema,
  groceryEditsSchema,
  planEditsSchema,
  writeCardBlockSchema,
} from "../coach-write-cards";
import { coachBlockSchema } from "../coach-blocks";

const block = {
  type: "write_card",
  cardId: "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
  kind: "food",
  status: "live",
  payload: {
    items: [
      {
        name: "Large eggs",
        unitLabel: "egg",
        perUnit: { calories: 72, protein: 6, carbs: 0, fat: 5 },
        count: 2,
        source: "lookup",
      },
    ],
    mealType: "breakfast",
    day: "today",
  },
};

describe("write-card edit schemas", () => {
  it("food counts are integers from 0 to 20", () => {
    expect(foodEditsSchema.safeParse({ counts: [0, 20] }).success).toBe(true);
    expect(foodEditsSchema.safeParse({ counts: [21] }).success).toBe(false);
    expect(foodEditsSchema.safeParse({ counts: [-1] }).success).toBe(false);
    expect(foodEditsSchema.safeParse({ counts: [1.5] }).success).toBe(false);
  });

  it("food edits never carry nutrition", () => {
    expect(foodEditsSchema.safeParse({ calories: 10 }).success).toBe(false);
  });

  it("grocery list choice is an id or new", () => {
    expect(groceryEditsSchema.safeParse({ listId: "new" }).success).toBe(true);
    expect(groceryEditsSchema.safeParse({ listId: 3 }).success).toBe(true);
    expect(groceryEditsSchema.safeParse({ listId: "x" }).success).toBe(false);
  });

  it("plan edits reject unknown keys", () => {
    expect(planEditsSchema.safeParse({ addShopping: true }).success).toBe(true);
    expect(planEditsSchema.safeParse({ recipeId: 4 }).success).toBe(false);
  });
});

describe("writeCardBlockSchema", () => {
  it("parses a food card block", () => {
    expect(writeCardBlockSchema.safeParse(block).success).toBe(true);
  });

  it("rejects a payload that does not match its kind", () => {
    expect(
      writeCardBlockSchema.safeParse({ ...block, kind: "grocery" }).success,
    ).toBe(false);
  });

  it("is part of the coach block union", () => {
    expect(coachBlockSchema.safeParse(block).success).toBe(true);
  });
});
