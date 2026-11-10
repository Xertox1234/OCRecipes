import { describe, it, expect, vi } from "vitest";
import type { WriteCardTx } from "../../../storage/coach-write-cards";
import { createMockCoachWriteCard } from "../../../__tests__/factories";

vi.mock("../food", async (orig) => ({
  ...(await orig<typeof import("../food")>()),
  performFoodSave: vi.fn(async () => ({ scannedItemIds: [1] })),
}));

const {
  describeLiveCard,
  performWriteCardSave,
  writeCardReceiptFor,
  WriteCardEditError,
} = await import("../index");
const food = await import("../food");

const foodCard = createMockCoachWriteCard({
  kind: "food",
  payload: {
    items: [
      {
        name: "large egg",
        unitLabel: "egg",
        perUnit: { calories: 72, protein: 6, carbs: 0, fat: 5 },
        count: 2,
        source: "lookup",
      },
      {
        name: "slice whole-wheat toast",
        unitLabel: "slice",
        perUnit: { calories: 82, protein: 4, carbs: 14, fat: 1 },
        count: 1,
        source: "estimate",
      },
    ],
    mealType: "breakfast",
    day: "today",
  },
});

const groceryCard = createMockCoachWriteCard({
  kind: "grocery",
  payload: {
    items: [
      { name: "Spinach", quantity: "1", unit: "bag", ticked: true },
      { name: "Ginger", quantity: null, unit: null, ticked: false },
    ],
    lists: [{ id: 7, title: "Weekly shop" }],
    defaultListId: 7,
    newListName: "Lentil stew",
  },
});

const ref = (title: string) => ({
  source: "community" as const,
  id: 1,
  title,
  calories: 500,
  protein: 40,
});
const planCard = createMockCoachWriteCard({
  kind: "plan",
  payload: {
    rows: [
      {
        plannedDate: "2026-11-09",
        mealType: "dinner",
        recipe: ref("Chicken shawarma bowl"),
        alternatives: [ref("Turkey chili")],
        alreadyPlanned: null,
      },
    ],
    shoppingListId: null,
  },
});

const tx = {} as WriteCardTx;

describe("describeLiveCard", () => {
  it("describes the food card with its numbers", () => {
    expect(describeLiveCard(foodCard)).toBe(
      "Card on screen (food, not saved): 2 × large egg (72 cal each), 1 × slice whole-wheat toast (82 cal each); Breakfast; today. To change it, call log_food_item again with the full updated contents.",
    );
  });

  it("describeLiveCard applies edits", () => {
    const edited = { ...foodCard, edits: { counts: [3, 1], day: "yesterday" } };
    expect(describeLiveCard(edited)).toContain("3 × large egg");
    expect(describeLiveCard(edited)).toContain("; yesterday.");
  });

  it("describes the grocery card's ticked items and list", () => {
    expect(describeLiveCard(groceryCard)).toBe(
      "Card on screen (grocery list, not saved): Spinach (1 bag) — ticked; Ginger — unticked; list: Weekly shop. To change it, call add_to_grocery_list again with the full updated contents.",
    );
  });

  it("describes the plan card with chosen swaps", () => {
    expect(describeLiveCard({ ...planCard, edits: { chosen: [0] } })).toBe(
      "Card on screen (meal plan, not saved): 2026-11-09 dinner: Turkey chili (500 cal, 40 g protein). To change it, call add_to_meal_plan again with the full updated contents.",
    );
  });

  it("ignores edits that do not parse", () => {
    expect(
      describeLiveCard({ ...foodCard, edits: { counts: ["x"] } }),
    ).toContain("2 × large egg");
  });
});

describe("performWriteCardSave", () => {
  const ctx = { userId: "1", tz: "UTC", now: new Date() };

  it("performWriteCardSave rejects unknown edit keys", async () => {
    await expect(
      performWriteCardSave(tx, foodCard, { calories: 900 }, ctx),
    ).rejects.toBeInstanceOf(WriteCardEditError);
    expect(food.performFoodSave).not.toHaveBeenCalled();
  });

  it("routes a food card to the food save", async () => {
    await performWriteCardSave(tx, foodCard, { counts: [1, 1] }, ctx);
    expect(food.performFoodSave).toHaveBeenCalledWith(
      tx,
      foodCard,
      { counts: [1, 1] },
      { userId: "1", now: ctx.now },
    );
  });
});

describe("writeCardReceiptFor", () => {
  it("uses the card's stored edits", () => {
    expect(
      writeCardReceiptFor({
        ...foodCard,
        edits: { counts: [3, 1], mealType: "lunch" },
      }),
    ).toBe("✓ Logged to Lunch · 298 cal");
  });

  it("names the grocery list the items went to", () => {
    expect(
      writeCardReceiptFor({
        ...groceryCard,
        savedRefs: { listId: 7, groceryItemIds: [1] },
      }),
    ).toBe("✓ Added 1 item to Weekly shop");
  });
});
