import { describe, it, expect } from "vitest";
import { categorizeIngredient } from "../grocery-categories";

describe("categorizeIngredient", () => {
  it("files common typed shopping words", () => {
    const rows: [string, string][] = [
      ["Milk", "dairy"],
      ["Eggs", "dairy"],
      ["Apples", "produce"],
      ["Mince", "meat"],
      ["Chopped tomatoes", "produce"],
      ["Bread", "bakery"],
      ["Coffee", "beverages"],
      ["Cereal", "grains"],
      ["Champagne", "beverages"],
      ["Bob's Red Sauce", "other"],
    ];
    for (const [name, category] of rows) {
      expect(categorizeIngredient(name), name).toBe(category);
    }
  });

  it("does not file household items under a food aisle", () => {
    // Each of these contains a food keyword ("ham" in shampoo, "roll").
    for (const name of [
      "Shampoo",
      "Kitchen roll",
      "Toilet roll",
      "Toilet paper",
      "Paper towels",
      "Dish soap",
      "Toothpaste",
      "Foil",
      "Bin bags",
      "Laundry detergent",
    ]) {
      expect(categorizeIngredient(name), name).toBe("other");
    }
  });
});
