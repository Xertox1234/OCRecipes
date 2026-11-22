import { describe, it, expect } from "vitest";
import { buildGroceryAdd } from "../grocery-add-utils";

describe("buildGroceryAdd", () => {
  it("sends the parsed name, amount and unit, and says what it becomes", () => {
    expect(buildGroceryAdd("milk 2l")).toEqual({
      fields: { name: "Milk", quantity: "2", unit: "L" },
      hint: "Becomes Milk · 2 L, under Dairy",
    });
    expect(buildGroceryAdd("2 cans chopped tomatoes")).toEqual({
      fields: { name: "Chopped tomatoes", quantity: "2", unit: "can" },
      hint: "Becomes Chopped tomatoes · 2 cans, under Produce",
    });
    expect(buildGroceryAdd("a dozen eggs")).toEqual({
      fields: { name: "Eggs", quantity: "12", unit: null },
      hint: "Becomes Eggs · 12, under Dairy",
    });
    expect(buildGroceryAdd("half a kilo of cheese")?.fields).toEqual({
      name: "Cheese",
      quantity: "0.5",
      unit: "kg",
    });
  });

  it("sends unreadable text as typed, with no amount", () => {
    expect(buildGroceryAdd("  Bob's Red Sauce ")).toEqual({
      fields: { name: "Bob's Red Sauce", quantity: null, unit: null },
      hint: "Becomes Bob's Red Sauce, under Other",
    });
  });

  it("keeps a pack multiplier in the name until the list can store one", () => {
    // "2 × 2 L" needs the count column from the amounts slice. Until then the
    // text is kept whole: never 4 L, never a silently dropped "x2".
    expect(buildGroceryAdd("Milk 2L x2")).toEqual({
      fields: { name: "Milk 2L x2", quantity: null, unit: null },
      hint: "Becomes Milk 2L x2, under Dairy",
    });
  });

  it("has nothing to add for blank text", () => {
    expect(buildGroceryAdd("   ")).toBeNull();
    expect(buildGroceryAdd("")).toBeNull();
  });
});
