import { describe, it, expect } from "vitest";
import { parseMenuFromOCR } from "../menu-ocr-parser";

describe("parseMenuFromOCR", () => {
  it("returns empty result for empty string", () => {
    const result = parseMenuFromOCR("");
    expect(result.items).toHaveLength(0);
    expect(result.restaurantName).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("returns empty result for whitespace-only string", () => {
    const result = parseMenuFromOCR("   \n\n  ");
    expect(result.items).toHaveLength(0);
    expect(result.restaurantName).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it("parses items with inline prices from a simple menu", () => {
    const text = [
      "The Grill House",
      "Grilled Salmon $18.99",
      "Caesar Salad $12.50",
      "Chicken Burger $14.00",
    ].join("\n");

    const result = parseMenuFromOCR(text);
    expect(result.restaurantName).toBe("The Grill House");
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({
      name: "Grilled Salmon",
      price: "$18.99",
    });
    expect(result.items[1]).toMatchObject({
      name: "Caesar Salad",
      price: "$12.50",
    });
    expect(result.items[2]).toMatchObject({
      name: "Chicken Burger",
      price: "$14.00",
    });
  });

  it("filters out section headers", () => {
    const text = [
      "Appetizers",
      "Spring Rolls $8.00",
      "Entrees",
      "Beef Steak $24.00",
      "Drinks",
      "Lemonade $4.50",
    ].join("\n");

    const result = parseMenuFromOCR(text);
    expect(result.items).toHaveLength(3);
    expect(result.items.map((i) => i.name)).toEqual([
      "Spring Rolls",
      "Beef Steak",
      "Lemonade",
    ]);
  });

  it("pairs a standalone price line with the preceding item name", () => {
    const text = ["Pasta Carbonara", "$16.00", "Tiramisu", "$9.00"].join("\n");

    const result = parseMenuFromOCR(text);
    expect(result.items).toHaveLength(2);
    expect(result.items[0]).toMatchObject({
      name: "Pasta Carbonara",
      price: "$16.00",
    });
    expect(result.items[1]).toMatchObject({ name: "Tiramisu", price: "$9.00" });
  });

  it("parses items without prices", () => {
    const text = [
      "Burger Joint",
      "Classic Burger",
      "Veggie Wrap",
      "Fish Tacos",
    ].join("\n");

    const result = parseMenuFromOCR(text);
    expect(result.restaurantName).toBe("Burger Joint");
    expect(result.items).toHaveLength(3);
    expect(result.items[0].price).toBeUndefined();
  });

  it("handles mixed currency symbols", () => {
    const text = [
      "Cafe Paris",
      "Croissant €3.50",
      "Espresso £2.00",
      "Bagel $4.25",
    ].join("\n");

    const result = parseMenuFromOCR(text);
    expect(result.items).toHaveLength(3);
    expect(result.items[0]).toMatchObject({
      name: "Croissant",
      price: "€3.50",
    });
    expect(result.items[1]).toMatchObject({ name: "Espresso", price: "£2.00" });
    expect(result.items[2]).toMatchObject({ name: "Bagel", price: "$4.25" });
  });

  it("returns high confidence when many items are found with a restaurant name", () => {
    const text = [
      "Sushi Palace",
      "Salmon Roll $12.00",
      "Tuna Nigiri $14.00",
      "Edamame $6.00",
      "Miso Soup $4.00",
      "Green Tea Ice Cream $7.00",
    ].join("\n");

    const result = parseMenuFromOCR(text);
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("returns low confidence for garbage text", () => {
    const result = parseMenuFromOCR("!@#$%^&*()\nrandom text\nno prices here");
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("does not use a line with digits as the restaurant name", () => {
    const text = ["1234 Main St", "Burger $10.00", "Fries $5.00"].join("\n");

    const result = parseMenuFromOCR(text);
    expect(result.restaurantName).toBeNull();
  });

  it("does not treat a long first line as the restaurant name", () => {
    const text = [
      "Welcome To Our Wonderful Bistro By The Sea",
      "Soup Of The Day $8.00",
    ].join("\n");

    const result = parseMenuFromOCR(text);
    expect(result.restaurantName).toBeNull();
  });
});
