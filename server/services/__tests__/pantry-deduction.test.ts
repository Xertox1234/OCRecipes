import { describe, it, expect } from "vitest";
import { deductPantryFromGrocery } from "../pantry-deduction";
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
