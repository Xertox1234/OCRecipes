import { describe, it, expect } from "vitest";
import {
  foodTotal,
  groceryKept,
  planKept,
  writeCardButtonLabel,
  writeCardReceipt,
  pantryKept,
  pantryRowAmount,
  PANTRY_ACTION_LABEL,
} from "../coach-write-card-math";
import type {
  FoodCardPayload,
  GroceryCardPayload,
  PlanCardPayload,
  PlanRecipeRef,
  PantryCardPayload,
} from "../../schemas/coach-write-cards";

const per = (calories: number) => ({ calories, protein: 6, carbs: 0, fat: 5 });

const food: FoodCardPayload = {
  items: [
    {
      name: "Large eggs",
      unitLabel: "egg",
      perUnit: per(72),
      count: 2,
      source: "lookup",
    },
    {
      name: "Whole-wheat toast",
      unitLabel: "slice",
      perUnit: per(82),
      count: 1,
      source: "estimate",
    },
  ],
  mealType: "breakfast",
  day: "today",
};

const item = (name: string, ticked = true) => ({
  name,
  quantity: "1",
  unit: null,
  ticked,
});

const grocery: GroceryCardPayload = {
  items: [
    item("Red lentils"),
    item("Canned tomatoes"),
    item("Ginger", false),
    item("Spinach"),
    item("Coconut milk"),
  ],
  lists: [{ id: 7, title: "Weekly shop" }],
  defaultListId: 7,
  newListName: "Lentil stew",
};

const ref = (id: number, title: string): PlanRecipeRef => ({
  source: "community",
  id,
  title,
  calories: 500,
  protein: 40,
});

const plan: PlanCardPayload = {
  rows: [
    {
      plannedDate: "2026-11-09",
      mealType: "dinner",
      recipe: ref(1, "Chicken shawarma bowl"),
      alternatives: [ref(11, "Turkey chili"), ref(12, "Tofu stir-fry")],
      alreadyPlanned: null,
    },
    {
      plannedDate: "2026-11-10",
      mealType: "dinner",
      recipe: ref(2, "Indian spiced lentil stew"),
      alternatives: [],
      alreadyPlanned: null,
    },
    {
      plannedDate: "2026-11-11",
      mealType: "dinner",
      recipe: ref(3, "Salmon with herb rice"),
      alternatives: [],
      alreadyPlanned: null,
    },
  ],
  shoppingListId: 7,
};

describe("foodTotal", () => {
  it("rounds the total, not each item", () => {
    const p: FoodCardPayload = {
      ...food,
      items: [
        { ...food.items[0], perUnit: per(72.4), count: 2 },
        { ...food.items[1], perUnit: per(82.4), count: 1 },
      ],
    };
    // per-item rounding would give 145 + 82 = 227
    expect(foodTotal(p, {})).toBe(227);
    expect(foodTotal(food, {})).toBe(226);
  });

  it("uses edited counts", () => {
    expect(foodTotal(food, { counts: [3, 1] })).toBe(298);
    expect(foodTotal(food, { counts: [0, 0] })).toBe(0);
  });
});

describe("groceryKept", () => {
  it("keeps the payload ticks without edits", () => {
    expect(groceryKept(grocery, {}).map((i) => i.name)).toEqual([
      "Red lentils",
      "Canned tomatoes",
      "Spinach",
      "Coconut milk",
    ]);
  });

  it("follows edited ticks", () => {
    const kept = groceryKept(grocery, {
      ticked: [true, false, false, true, true],
    });
    expect(kept).toHaveLength(3);
  });
});

describe("planKept", () => {
  it("drops removed rows and applies chosen alternatives", () => {
    const kept = planKept(plan, {
      removed: [false, true, false],
      chosen: [1, null, null],
    });
    expect(kept.map((r) => r.recipe.title)).toEqual([
      "Tofu stir-fry",
      "Salmon with herb rice",
    ]);
  });
});

describe("writeCardButtonLabel", () => {
  it("food", () => {
    expect(writeCardButtonLabel("food", food, {})).toBe("Log 226 cal");
  });

  it("grocery, plural and singular", () => {
    expect(writeCardButtonLabel("grocery", grocery, {})).toBe("Add 4 items");
    expect(
      writeCardButtonLabel("grocery", grocery, {
        ticked: [true, false, false, false, false],
      }),
    ).toBe("Add 1 item");
  });

  it("plan names one meal type, else meals", () => {
    expect(writeCardButtonLabel("plan", plan, {})).toBe(
      "Add 3 dinners to plan",
    );
    expect(
      writeCardButtonLabel("plan", plan, { removed: [false, false, true] }),
    ).toBe("Add 2 dinners to plan");
    const mixed: PlanCardPayload = {
      ...plan,
      rows: [plan.rows[0], { ...plan.rows[1], mealType: "lunch" }],
    };
    expect(writeCardButtonLabel("plan", mixed, {})).toBe("Add 2 meals to plan");
    const one: PlanCardPayload = { ...plan, rows: [plan.rows[0]] };
    expect(writeCardButtonLabel("plan", one, {})).toBe("Add 1 dinner to plan");
  });

  it("plan pluralises lunch as lunches", () => {
    const lunches: PlanCardPayload = {
      ...plan,
      rows: plan.rows.map((r) => ({ ...r, mealType: "lunch" as const })),
    };
    expect(writeCardButtonLabel("plan", lunches, {})).toBe(
      "Add 3 lunches to plan",
    );
    expect(
      writeCardButtonLabel("plan", { ...lunches, rows: [lunches.rows[0]] }, {}),
    ).toBe("Add 1 lunch to plan");
  });
});

describe("writeCardReceipt", () => {
  it("food", () => {
    expect(writeCardReceipt("food", food, {})).toBe(
      "✓ Logged to Breakfast · 226 cal",
    );
  });

  it("grocery names the list", () => {
    expect(writeCardReceipt("grocery", grocery, {}, "Weekly shop")).toBe(
      "✓ Added 4 items to Weekly shop",
    );
  });

  it("plan", () => {
    expect(writeCardReceipt("plan", plan, {})).toBe("✓ 3 dinners added");
  });
});

describe("pantry card", () => {
  const row = (over: Partial<PantryCardPayload["rows"][number]>) => ({
    action: "add" as const,
    name: "Eggs",
    quantity: null,
    unit: null,
    itemId: null,
    held: null,
    all: false,
    expiresInDays: null,
    ...over,
  });
  const pantry: PantryCardPayload = {
    rows: [
      row({ quantity: "12" }),
      row({
        action: "use",
        name: "Milk",
        quantity: "1",
        unit: "L",
        itemId: 7,
        held: "2.00",
      }),
      row({
        action: "use",
        name: "Rice",
        itemId: 8,
        held: "500.00",
        unit: "g",
        all: true,
      }),
      row({
        action: "remove",
        name: "Spinach",
        itemId: 9,
        held: "1.00",
        unit: "bag",
      }),
      row({ action: "remove", name: "Salt", itemId: 10 }),
      row({ name: "Greek yogurt", quantity: "500", unit: "g" }),
    ],
  };

  it("every row starts ticked and edits untick", () => {
    expect(pantryKept(pantry, {})).toHaveLength(6);
    expect(
      pantryKept(pantry, { ticked: [true, false, true, true, true, true] }).map(
        (r) => r.name,
      ),
    ).toEqual(["Eggs", "Rice", "Spinach", "Salt", "Greek yogurt"]);
  });

  it("amounts read naturally and never show trailing zeros", () => {
    expect(pantry.rows.map(pantryRowAmount)).toEqual([
      "12",
      "1 L of 2 L",
      "all (500 g)",
      "1 bag",
      "",
      "500 g",
    ]);
  });

  it("each action has a word, not just a colour", () => {
    expect(
      pantry.rows.slice(0, 4).map((r) => PANTRY_ACTION_LABEL[r.action]),
    ).toEqual(["Add", "Use", "Use", "Remove"]);
  });

  it("button and fallback receipt", () => {
    expect(writeCardButtonLabel("pantry", pantry, {})).toBe("Update pantry");
    expect(writeCardReceipt("pantry", pantry, {})).toBe("✓ Pantry updated");
    const goals = {
      rows: [
        { key: "calories" as const, current: 1800, proposed: 2000 },
        { key: "protein" as const, current: null, proposed: 150 },
      ],
    };
    const allergy = { allergen: "tree_nuts" as const };
    expect(writeCardButtonLabel("allergy", allergy, {})).toBe(
      "Add to allergies",
    );
    expect(writeCardReceipt("allergy", allergy, { severity: "severe" })).toBe(
      "✓ Tree nuts added to your allergies · severe",
    );
    expect(writeCardButtonLabel("goals", goals, {})).toBe("Update goals");
    expect(writeCardReceipt("goals", goals, { values: [2100, 150] })).toBe(
      "✓ Goals updated · 2,100 cal · 150 g protein",
    );
  });
});
