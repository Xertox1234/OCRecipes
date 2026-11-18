import { describe, it, expect } from "vitest";
import {
  deductPantryFromGrocery,
  groupPantryByKey,
  matchKey,
  pantryVerdict,
  unitKey,
} from "../pantry-deduction";
import type { AggregatedGroceryItem } from "../grocery-generation";
import type { PantryItem } from "@shared/schema";

function makeGroceryItem(
  overrides: Partial<AggregatedGroceryItem> & { name: string },
): AggregatedGroceryItem {
  return {
    name: overrides.name,
    quantity: overrides.quantity ?? null,
    unit: overrides.unit ?? null,
    category: overrides.category ?? "other",
  };
}

function makePantryItem(
  overrides: Partial<PantryItem> & { name: string; userId: string },
): PantryItem {
  return {
    id: overrides.id ?? 1,
    userId: overrides.userId,
    name: overrides.name,
    quantity: overrides.quantity ?? null,
    unit: overrides.unit ?? null,
    category: overrides.category ?? "other",
    expiresAt: overrides.expiresAt ?? null,
    addedAt: overrides.addedAt ?? new Date(),
    updatedAt: overrides.updatedAt ?? new Date(),
  };
}

describe("deductPantryFromGrocery", () => {
  it("should return grocery items unchanged when pantry is empty", () => {
    const grocery = [
      makeGroceryItem({ name: "chicken breast", quantity: 500, unit: "g" }),
    ];
    const result = deductPantryFromGrocery(grocery, []);
    expect(result).toEqual(grocery);
  });

  it("should subtract matching pantry item quantities", () => {
    const grocery = [
      makeGroceryItem({ name: "chicken breast", quantity: 500, unit: "g" }),
    ];
    const pantry = [
      makePantryItem({
        name: "Chicken Breast",
        userId: "u1",
        quantity: "200",
        unit: "g",
      }),
    ];
    const result = deductPantryFromGrocery(grocery, pantry);
    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(300);
  });

  it("should remove item when pantry fully covers it", () => {
    const grocery = [
      makeGroceryItem({ name: "flour", quantity: 200, unit: "g" }),
    ];
    const pantry = [
      makePantryItem({
        name: "flour",
        userId: "u1",
        quantity: "500",
        unit: "g",
      }),
    ];
    const result = deductPantryFromGrocery(grocery, pantry);
    expect(result).toHaveLength(0);
  });

  it("should not deduct when units differ", () => {
    const grocery = [
      makeGroceryItem({ name: "flour", quantity: 2, unit: "cups" }),
    ];
    const pantry = [
      makePantryItem({
        name: "flour",
        userId: "u1",
        quantity: "500",
        unit: "g",
      }),
    ];
    const result = deductPantryFromGrocery(grocery, pantry);
    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(2);
  });

  it("should preserve items with no pantry match", () => {
    const grocery = [
      makeGroceryItem({ name: "chicken breast", quantity: 500, unit: "g" }),
      makeGroceryItem({ name: "olive oil", quantity: 1, unit: "tbsp" }),
    ];
    const pantry = [
      makePantryItem({
        name: "chicken breast",
        userId: "u1",
        quantity: "200",
        unit: "g",
      }),
    ];
    const result = deductPantryFromGrocery(grocery, pantry);
    expect(result).toHaveLength(2);
    expect(result[0].quantity).toBe(300);
    expect(result[1].name).toBe("olive oil");
    expect(result[1].quantity).toBe(1);
  });

  it("should match case-insensitively and trim whitespace", () => {
    const grocery = [
      makeGroceryItem({ name: "Brown Rice", quantity: 500, unit: "g" }),
    ];
    const pantry = [
      makePantryItem({
        name: "  brown rice  ",
        userId: "u1",
        quantity: "200",
        unit: "G",
      }),
    ];
    const result = deductPantryFromGrocery(grocery, pantry);
    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(300);
  });

  it("should handle grocery items with null quantity", () => {
    const grocery = [
      makeGroceryItem({ name: "salt", quantity: null, unit: null }),
    ];
    const pantry = [
      makePantryItem({
        name: "salt",
        userId: "u1",
        quantity: "100",
        unit: null,
      }),
    ];
    const result = deductPantryFromGrocery(grocery, pantry);
    // Can't subtract from null quantity, so keep it
    expect(result).toHaveLength(1);
  });

  it("should handle multiple pantry items for same ingredient", () => {
    const grocery = [
      makeGroceryItem({ name: "chicken breast", quantity: 1000, unit: "g" }),
    ];
    const pantry = [
      makePantryItem({
        id: 1,
        name: "chicken breast",
        userId: "u1",
        quantity: "300",
        unit: "g",
      }),
      makePantryItem({
        id: 2,
        name: "chicken breast",
        userId: "u1",
        quantity: "200",
        unit: "g",
      }),
    ];
    const result = deductPantryFromGrocery(grocery, pantry);
    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe(500);
  });

  it("should return empty array for empty grocery list", () => {
    const pantry = [
      makePantryItem({
        name: "chicken",
        userId: "u1",
        quantity: "500",
        unit: "g",
      }),
    ];
    const result = deductPantryFromGrocery([], pantry);
    expect(result).toEqual([]);
  });
});

describe("deductPantryFromGrocery quantity parsing (R36)", () => {
  it("parses fraction pantry quantities instead of truncating at the slash", () => {
    const grocery = [
      makeGroceryItem({ name: "butter", quantity: 1, unit: "cup" }),
    ];
    const pantry = [
      makePantryItem({
        name: "butter",
        quantity: "1/2",
        unit: "cup",
        userId: "u",
      }),
    ];
    // parseFloat("1/2") === 1 would wrongly cover the whole cup.
    const result = deductPantryFromGrocery(grocery, pantry);
    expect(result).toEqual([{ ...grocery[0], quantity: 0.5 }]);
  });

  it("rounds the remaining quantity", () => {
    const grocery = [
      makeGroceryItem({ name: "oil", quantity: 0.3, unit: "cup" }),
    ];
    const pantry = [
      makePantryItem({
        name: "oil",
        quantity: "0.1",
        unit: "cup",
        userId: "u",
      }),
    ];
    const result = deductPantryFromGrocery(grocery, pantry);
    expect(result[0].quantity).toBe(0.2);
  });
});

describe("matchKey", () => {
  it.each([
    ["Apples", "apple"],
    ["  Red   Apples ", "red apple"],
    ["tomatoes", "tomato"],
    ["peaches", "peach"],
    ["radishes", "radish"],
    ["boxes", "box"],
    ["glasses", "glass"],
    ["berries", "berry"],
    ["cookie", "cooky"],
    ["cookies", "cooky"],
    ["chickpeas", "chickpea"],
    ["egg", "egg"],
    ["grass", "grass"],
    // Endings count only at the end of the name; earlier letters stay put.
    ["cookie jars", "cookie jar"],
    ["pierogies", "pierogy"],
    ["shoestrings", "shoestring"],
    ["fresh tomatoes", "fresh tomato"],
    ["sprouts", "sprout"],
  ])("%j → %j", (name, key) => {
    expect(matchKey(name)).toBe(key);
  });

  it("gives singular and plural the same key", () => {
    expect(matchKey("eggs")).toBe(matchKey("egg"));
    expect(matchKey("potatoes")).toBe(matchKey("Potato"));
  });
});

describe("unitKey", () => {
  it("lower-cases and trims", () => {
    expect(unitKey("  Cups ")).toBe("cups");
  });
  it("treats a missing unit as empty", () => {
    expect(unitKey(null)).toBe("");
    expect(unitKey(undefined)).toBe("");
  });
});

describe("pantryVerdict", () => {
  const row = (quantity: string | null, unit: string | null = null) =>
    makePantryItem({ userId: "u1", name: "milk", quantity, unit });

  it("buys when the pantry has no row", () => {
    expect(pantryVerdict({ quantity: "1", unit: "cup" }, [])).toBe("buy");
  });

  it("buys when every row is used up", () => {
    expect(
      pantryVerdict({ quantity: "1", unit: "cup" }, [row("0", "cup")]),
    ).toBe("buy");
  });

  it("buys an item with no amount when the pantry has no row", () => {
    expect(pantryVerdict({ quantity: null, unit: null }, [])).toBe("buy");
  });

  it("ignores a used-up row even in another unit", () => {
    expect(pantryVerdict({ quantity: "2", unit: "cup" }, [row("0", "l")])).toBe(
      "buy",
    );
  });

  it("counts a row of unknown amount as stocked", () => {
    expect(pantryVerdict({ quantity: null }, [row(null)])).toBe("covered");
  });

  it("covers an item that asks for no amount", () => {
    expect(pantryVerdict({ quantity: null, unit: null }, [row("1", "l")])).toBe(
      "covered",
    );
  });

  it("covers when the same unit holds exactly enough", () => {
    expect(
      pantryVerdict({ quantity: "2", unit: "cup" }, [row("2", "cup")]),
    ).toBe("covered");
  });

  it("adds up several rows in the same unit, matching unit case and spaces", () => {
    expect(
      pantryVerdict({ quantity: "2", unit: "Cup" }, [
        row("1", " cup"),
        row("1", "CUP"),
      ]),
    ).toBe("covered");
  });

  it("buys when a known amount in the same unit is too small", () => {
    expect(
      pantryVerdict({ quantity: "3", unit: "cup" }, [row("2", "cup")]),
    ).toBe("buy");
  });

  it("is unsure when the pantry holds it in another unit", () => {
    expect(pantryVerdict({ quantity: "2", unit: "cup" }, [row("1", "l")])).toBe(
      "unsure",
    );
  });

  it("is unsure when the pantry amount is unknown", () => {
    expect(
      pantryVerdict({ quantity: "2", unit: "cup" }, [row(null, "cup")]),
    ).toBe("unsure");
  });

  it("covers when the same-unit rows are enough even beside another unit", () => {
    expect(
      pantryVerdict({ quantity: "2", unit: "cup" }, [
        row("1", "l"),
        row("2", "cup"),
      ]),
    ).toBe("covered");
  });
});

describe("groupPantryByKey", () => {
  const now = new Date("2026-11-18T12:00:00Z");

  it("groups singular and plural names under one key", () => {
    const groups = groupPantryByKey(
      [
        makePantryItem({ id: 1, userId: "u1", name: "Eggs" }),
        makePantryItem({ id: 2, userId: "u1", name: "egg" }),
      ],
      now,
    );
    expect([...groups.keys()]).toEqual(["egg"]);
    expect(groups.get("egg")?.map((r) => r.id)).toEqual([1, 2]);
  });

  it("skips rows that expire at or before now and keeps the rest", () => {
    const groups = groupPantryByKey(
      [
        makePantryItem({ id: 1, userId: "u1", name: "milk", expiresAt: now }),
        makePantryItem({
          id: 2,
          userId: "u1",
          name: "milk",
          expiresAt: new Date(now.getTime() - 1),
        }),
        makePantryItem({
          id: 3,
          userId: "u1",
          name: "milk",
          expiresAt: new Date(now.getTime() + 1),
        }),
        makePantryItem({ id: 4, userId: "u1", name: "milk", expiresAt: null }),
      ],
      now,
    );
    expect(groups.get("milk")?.map((r) => r.id)).toEqual([3, 4]);
  });
});
