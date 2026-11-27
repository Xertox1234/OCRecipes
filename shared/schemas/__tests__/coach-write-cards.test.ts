import { describe, it, expect } from "vitest";
import {
  allergyEditsSchema,
  foodEditsSchema,
  goalsCardPayloadSchema,
  goalsEditsSchema,
  groceryEditsSchema,
  planEditsSchema,
  familyCardPayloadSchema,
  familyEditsSchema,
  remindersCardPayloadSchema,
  remindersEditsSchema,
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
    expect(planEditsSchema.safeParse({ shoppingListId: "new" }).success).toBe(
      true,
    );
    expect(planEditsSchema.safeParse({ shoppingListId: 4 }).success).toBe(true);
    expect(planEditsSchema.safeParse({ shoppingListId: "x" }).success).toBe(
      false,
    );
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

describe("goals write card", () => {
  const goalsBlock = {
    type: "write_card",
    cardId: "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
    kind: "goals",
    status: "live",
    payload: {
      rows: [
        { key: "calories", current: 1800, proposed: 2000 },
        { key: "protein", current: null, proposed: 150 },
      ],
    },
  };

  it("a goals block passes the coach block schema, so the app does not drop it", () => {
    expect(coachBlockSchema.safeParse(goalsBlock).success).toBe(true);
    expect(writeCardBlockSchema.safeParse(goalsBlock).success).toBe(true);
  });

  it("a goals payload under another kind is refused", () => {
    expect(
      writeCardBlockSchema.safeParse({ ...goalsBlock, kind: "pantry" }).success,
    ).toBe(false);
  });

  it.each([
    [
      "calories under the 1,200 floor",
      [{ key: "calories", current: 1800, proposed: 1100 }],
    ],
    ["a value past its bound", [{ key: "fat", current: null, proposed: 501 }]],
    ["a fraction", [{ key: "protein", current: null, proposed: 150.5 }]],
    [
      "the same goal twice",
      [
        { key: "protein", current: null, proposed: 150 },
        { key: "protein", current: null, proposed: 160 },
      ],
    ],
    ["no rows", []],
  ])("refuses a payload with %s", (_name, rows) => {
    expect(goalsCardPayloadSchema.safeParse({ rows }).success).toBe(false);
  });

  it("edits are strict: values only", () => {
    expect(goalsEditsSchema.safeParse({ values: [2000] }).success).toBe(true);
    expect(
      goalsEditsSchema.safeParse({ values: [2000], key: "fat" }).success,
    ).toBe(false);
    expect(goalsEditsSchema.safeParse({ values: [2000.5] }).success).toBe(
      false,
    );
  });
});

describe("allergy write card", () => {
  const allergyBlock = {
    type: "write_card",
    cardId: "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
    kind: "allergy",
    status: "live",
    payload: { allergen: "shellfish" },
  };

  it("an allergy block passes the coach block schema, so the app does not drop it", () => {
    expect(coachBlockSchema.safeParse(allergyBlock).success).toBe(true);
    expect(writeCardBlockSchema.safeParse(allergyBlock).success).toBe(true);
  });

  it("an allergy payload under another kind is refused, and so is an allergen the profile cannot hold", () => {
    expect(
      writeCardBlockSchema.safeParse({ ...allergyBlock, kind: "goals" })
        .success,
    ).toBe(false);
    expect(
      writeCardBlockSchema.safeParse({
        ...allergyBlock,
        payload: { allergen: "strawberries" },
      }).success,
    ).toBe(false);
  });

  it("edits are strict: a severity only", () => {
    expect(allergyEditsSchema.safeParse({ severity: "mild" }).success).toBe(
      true,
    );
    expect(allergyEditsSchema.safeParse({ severity: "deadly" }).success).toBe(
      false,
    );
    expect(
      allergyEditsSchema.safeParse({ severity: "mild", allergen: "fish" })
        .success,
    ).toBe(false);
  });
});

describe("pantry write card", () => {
  const pantryBlock = {
    ...block,
    kind: "pantry",
    payload: {
      rows: [
        {
          action: "add",
          name: "Eggs",
          quantity: "12",
          unit: null,
          itemId: null,
          held: null,
          all: false,
          expiresInDays: null,
        },
        {
          action: "use",
          name: "Milk",
          quantity: "1",
          unit: "L",
          itemId: 7,
          held: "2.00",
          all: false,
          expiresInDays: null,
        },
      ],
    },
  };

  it("a pantry block passes the coach block schema, so the app does not drop it", () => {
    expect(coachBlockSchema.safeParse(pantryBlock).success).toBe(true);
    expect(writeCardBlockSchema.safeParse(pantryBlock).success).toBe(true);
  });

  it("a pantry payload under another kind is refused", () => {
    expect(
      writeCardBlockSchema.safeParse({ ...pantryBlock, kind: "plan" }).success,
    ).toBe(false);
  });

  it("pantry edits are ticks only", async () => {
    const { pantryEditsSchema } = await import("../coach-write-cards");
    expect(pantryEditsSchema.safeParse({ ticked: [true, false] }).success).toBe(
      true,
    );
    expect(
      pantryEditsSchema.safeParse({ ticked: [true], quantity: "99" }).success,
    ).toBe(false);
  });
});

describe("reminders write card (Coach roadmap A3)", () => {
  const remindersBlock = {
    type: "write_card",
    cardId: "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
    kind: "reminders",
    status: "live",
    payload: {
      changes: [
        { key: "meal-log", on: false },
        { key: "daily-checkin", on: true },
      ],
    },
  };

  it("a reminders block passes the coach block schema, so the app does not drop it", () => {
    expect(coachBlockSchema.safeParse(remindersBlock).success).toBe(true);
    expect(writeCardBlockSchema.safeParse(remindersBlock).success).toBe(true);
  });

  it("a reminders payload under another kind is refused, and the other way round", () => {
    expect(
      writeCardBlockSchema.safeParse({ ...remindersBlock, kind: "goals" })
        .success,
    ).toBe(false);
    expect(
      writeCardBlockSchema.safeParse({
        ...remindersBlock,
        payload: { rows: [{ key: "calories", current: 1800, proposed: 2000 }] },
      }).success,
    ).toBe(false);
  });

  it.each([
    ["no changes", []],
    ["an unknown reminder", [{ key: "weigh-in", on: true }]],
    [
      "the same reminder twice",
      [
        { key: "commitment", on: true },
        { key: "commitment", on: false },
      ],
    ],
  ])("refuses a payload with %s", (_name, changes) => {
    expect(remindersCardPayloadSchema.safeParse({ changes }).success).toBe(
      false,
    );
  });

  it("edits are strict: one on/off per row", () => {
    expect(remindersEditsSchema.safeParse({ on: [true, false] }).success).toBe(
      true,
    );
    expect(remindersEditsSchema.safeParse({}).success).toBe(true);
    expect(
      remindersEditsSchema.safeParse({ on: [true], key: "meal-log" }).success,
    ).toBe(false);
    expect(remindersEditsSchema.safeParse({ on: ["yes"] }).success).toBe(false);
    expect(
      remindersEditsSchema.safeParse({ on: [true, true, true, true, true] })
        .success,
    ).toBe(false);
  });
});

describe("family write card (Coach roadmap A3)", () => {
  const familyBlock = {
    type: "write_card",
    cardId: "6f1c2b9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
    kind: "family",
    status: "live",
    payload: { name: "Sam", allergens: ["peanuts", "milk"] },
  };

  it("a family block passes the coach block schema, so the app does not drop it", () => {
    expect(coachBlockSchema.safeParse(familyBlock).success).toBe(true);
    expect(writeCardBlockSchema.safeParse(familyBlock).success).toBe(true);
    expect(
      familyCardPayloadSchema.safeParse({ name: "Sam", allergens: [] }).success,
    ).toBe(true);
  });

  it("a family payload under another kind is refused", () => {
    expect(
      writeCardBlockSchema.safeParse({ ...familyBlock, kind: "allergy" })
        .success,
    ).toBe(false);
  });

  it.each([
    ["a blank name", { name: "  ", allergens: [] }],
    ["a name past 50 characters", { name: "x".repeat(51), allergens: [] }],
    [
      "an allergen the editor does not hold",
      { name: "Sam", allergens: ["kiwi"] },
    ],
    ["the same allergen twice", { name: "Sam", allergens: ["milk", "milk"] }],
  ])("refuses a payload with %s", (_name, payload) => {
    expect(familyCardPayloadSchema.safeParse(payload).success).toBe(false);
  });

  it("edits are strict: one severity (or none yet) per allergen", () => {
    expect(
      familyEditsSchema.safeParse({ severities: ["mild", null] }).success,
    ).toBe(true);
    expect(familyEditsSchema.safeParse({}).success).toBe(true);
    expect(
      familyEditsSchema.safeParse({ severities: ["mild"], name: "Tom" })
        .success,
    ).toBe(false);
    expect(familyEditsSchema.safeParse({ severities: ["awful"] }).success).toBe(
      false,
    );
  });
});
