import { describe, it, expect } from "vitest";
import {
  foodTotal,
  groceryKept,
  planKept,
  writeCardButtonLabel,
  writeCardReceipt,
} from "../coach-write-card-math";
import type {
  FoodCardPayload,
  GroceryCardPayload,
  PlanCardPayload,
  PlanRecipeRef,
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
