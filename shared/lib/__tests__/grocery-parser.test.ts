import { describe, it, expect } from "vitest";
import {
  parseGroceryText,
  tidyGroceryName,
  isMeasuredUnit,
} from "../grocery-parser";

/** [typed, name, quantity, unit, count?] */
type Row = [string, string, number | null, string | null, number?];

function expectRows(rows: Row[]) {
  for (const [typed, name, quantity, unit, count = 1] of rows) {
    expect(parseGroceryText(typed), typed).toEqual({
      name,
      quantity,
      unit,
      count,
    });
  }
}

describe("parseGroceryText", () => {
  it("reads every example in the spec's goals", () => {
    expectRows([
      ["Milk 2L", "Milk", 2, "L"],
      ["2L milk", "Milk", 2, "L"],
      ["milk x2", "Milk", 2, null],
      ["2 x milk", "Milk", 2, null],
      ["3 apples", "Apples", 3, null],
      // A unit letter must be a whole word: never 3 L of "emons".
      ["3 lemons", "Lemons", 3, null],
      ["2 grapes", "Grapes", 2, null],
      ["lemons 3", "Lemons", 3, null],
      ["a dozen eggs", "Eggs", 12, null],
      ["500g mince", "Mince", 500, "g"],
      ["half a kilo of cheese", "Cheese", 0.5, "kg"],
      ["2 cans chopped tomatoes", "Chopped tomatoes", 2, "can"],
      ["eggs 12", "Eggs", 12, null],
    ]);
  });

  it("reads glued and spaced units, and their spellings", () => {
    expectRows([
      ["milk 2 L", "Milk", 2, "L"],
      ["2 litres milk", "Milk", 2, "L"],
      ["2 liters of milk", "Milk", 2, "L"],
      ["milk 2 litres", "Milk", 2, "L"],
      ["500 grams mince", "Mince", 500, "g"],
      ["1.5kg potatoes", "Potatoes", 1.5, "kg"],
      ["cream 250ml", "Cream", 250, "ml"],
      ["2 lbs beef", "Beef", 2, "lb"],
      ["8 oz cheddar", "Cheddar", 8, "oz"],
      ["2 cups flour", "Flour", 2, "cup"],
      ["3 packets crisps", "Crisps", 3, "pack"],
      ["1 jar honey", "Honey", 1, "jar"],
      ["2 bottles wine", "Wine", 2, "bottle"],
      ["2 bunches of bananas", "Bananas", 2, "bunch"],
      ["2 loaves of bread", "Bread", 2, "loaf"],
      ["1 bag rice", "Rice", 1, "bag"],
      ["2 boxes cereal", "Cereal", 2, "box"],
      ["tomatoes 2 cans", "Tomatoes", 2, "can"],
    ]);
  });

  it("reads fractions", () => {
    expectRows([
      ["1/2 kg mince", "Mince", 0.5, "kg"],
      ["½ kg mince", "Mince", 0.5, "kg"],
      ["1 1/2 kg mince", "Mince", 1.5, "kg"],
    ]);
  });

  it("reads number words only where a unit or 'dozen' follows", () => {
    expectRows([
      ["a loaf of bread", "Bread", 1, "loaf"],
      ["two loaves of bread", "Bread", 2, "loaf"],
      ["three cans tuna", "Tuna", 3, "can"],
      ["dozen eggs", "Eggs", 12, null],
      ["two dozen eggs", "Eggs", 24, null],
      ["2 dozen eggs", "Eggs", 24, null],
      ["half a dozen eggs", "Eggs", 6, null],
      ["a couple of lemons", "Lemons", 2, null],
      ["half a cup of sugar", "Sugar", 0.5, "cup"],
      // No unit after the word: leave it as typed.
      ["three apples", "Three apples", null, null],
      ["an apple", "An apple", null, null],
      ["three bean salad", "Three bean salad", null, null],
      ["four cheese pizza", "Four cheese pizza", null, null],
    ]);
  });

  it("reads multipliers in every position", () => {
    expectRows([
      ["milk x2", "Milk", 2, null],
      ["milk x 2", "Milk", 2, null],
      ["milk ×2", "Milk", 2, null],
      ["milk 2x", "Milk", 2, null],
      ["2x milk", "Milk", 2, null],
      ["2 x milk", "Milk", 2, null],
      ["Milk 2L x2", "Milk", 2, "L", 2],
      ["2 x 500g mince", "Mince", 500, "g", 2],
    ]);
  });

  it("drops only a joining 'of' and a leading 'some'", () => {
    expectRows([
      ["some milk", "Milk", null, null],
      ["2 cans of beans", "Beans", 2, "can"],
      ["some", "Some", null, null],
      ["cream of tartar", "Cream of tartar", null, null],
    ]);
  });

  it("adds unreadable input as typed", () => {
    expectRows([
      ["Bob's Red Sauce", "Bob's Red Sauce", null, null],
      ["PG Tips", "PG Tips", null, null],
      ["  kitchen   roll ", "Kitchen roll", null, null],
      ["SPF 50 sunscreen", "SPF 50 sunscreen", null, null],
      ["2% milk", "2% milk", null, null],
      ["2 percent milk", "2 percent milk", null, null],
      ["7 Up", "7 Up", null, null],
      ["Heinz 57", "Heinz 57", null, null],
      ["half and half", "Half and half", null, null],
      ["five spice", "Five spice", null, null],
      ["WD-40", "WD-40", null, null],
      ["formula 409", "Formula 409", null, null],
      // A second number left in the name makes the reading doubtful.
      ["Lays 2 for 1", "Lays 2 for 1", null, null],
      ["Coffee 1 kg 3", "Coffee 1 kg 3", null, null],
      ["Ensure 8 oz 6 pack", "Ensure 8 oz 6 pack", null, null],
      ["2 cans 400g tomatoes", "2 cans 400g tomatoes", null, null],
      // A trailing number that names the product, not how many.
      ["Vitamin B 12", "Vitamin B 12", null, null],
      ["Omega 3", "Omega 3", null, null],
      ["Baby food stage 2", "Baby food stage 2", null, null],
      ["nappies size 4", "Nappies size 4", null, null],
      // An amount with no name is not an item.
      ["2L", "2L", null, null],
      ["x2", "X2", null, null],
      ["12", "12", null, null],
      // Out of range or zero: keep the text.
      ["0 apples", "0 apples", null, null],
      ["10000 apples", "10000 apples", null, null],
      // A multiplier on a counted amount is unclear.
      ["2 x 3 apples", "2 x 3 apples", null, null],
      ["", "", null, null],
    ]);
  });

  it("keeps capitals beyond the first letter", () => {
    expect(parseGroceryText("pG tips 2 boxes").name).toBe("PG tips");
    expect(parseGroceryText("2 jars Bob's Red Sauce").name).toBe(
      "Bob's Red Sauce",
    );
  });

  it("never loses a word of the name (awkward names x amount forms)", () => {
    const names = [
      "PG Tips",
      "Bob's Red Sauce",
      "7 Up",
      "half and half",
      "2% milk",
      "Heinz 57",
      "SPF 50 sunscreen",
      "five spice",
      "mac and cheese",
      "cream of tartar",
      "milk",
    ];
    const forms: ((n: string) => string)[] = [
      (n) => n,
      (n) => `2L ${n}`,
      (n) => `${n} 2L`,
      (n) => `3 ${n}`,
      (n) => `${n} 3`,
      (n) => `${n} x2`,
      (n) => `2 x ${n}`,
      (n) => `2 cans ${n}`,
      (n) => `2 cans of ${n}`,
      (n) => `a dozen ${n}`,
      (n) => `${n} 2 jars`,
      (n) => `some ${n}`,
    ];
    let parsed = 0;
    for (const n of names) {
      for (const form of forms) {
        const typed = form(n);
        const result = parseGroceryText(typed);
        const asTyped = result.name === tidyGroceryName(typed);
        const nameKept = result.name === tidyGroceryName(n);
        expect(asTyped || nameKept, `${typed} -> ${result.name}`).toBe(true);
        if (result.quantity !== null) parsed++;
      }
    }
    // The table must exercise the parsed branch, not only the as-typed one.
    expect(parsed).toBeGreaterThan(40);
  });
});

describe("isMeasuredUnit", () => {
  it("is true for L, ml, g, kg, lb and oz only", () => {
    for (const u of ["L", "ml", "g", "kg", "lb", "oz"]) {
      expect(isMeasuredUnit(u), u).toBe(true);
    }
    for (const u of ["cup", "can", "pack", "tbsp", "", null, undefined]) {
      expect(isMeasuredUnit(u), String(u)).toBe(false);
    }
  });
});
