import type { ParsedFoodItem } from "@/hooks/useFoodParse";
import {
  entryTotals,
  exceedsCaps,
  formatAmount,
  retryKey,
  rowAmountLabel,
  rowCalories,
  rowCaption,
  stepFor,
  stepRow,
  suggestionsFor,
  toEntryRows,
  type EntryRow,
} from "../simple-entry-utils";

function item(overrides: Partial<ParsedFoodItem> = {}): ParsedFoodItem {
  return {
    name: "bacon",
    quantity: 3,
    unit: "slices",
    calories: 129,
    protein: 9,
    carbs: 0.3,
    fat: 10.2,
    servingSize: "3 slices (24 g)",
    ...overrides,
  };
}

function row(overrides: Partial<ParsedFoodItem> = {}): EntryRow {
  return toEntryRows([item(overrides)], { isExtra: false, idPrefix: "t" })[0];
}

describe("toEntryRows", () => {
  it("reads the weight from the serving size", () => {
    expect(row().baseGrams).toBe(24);
    expect(row({ servingSize: "3 slices" }).baseGrams).toBeNull();
    expect(row({ servingSize: null }).baseGrams).toBeNull();
  });

  it("turns an unknown portion into an adjustable 100 g", () => {
    const unknown = row({
      servingSize: "100 g (portion unknown)",
      quantity: 2,
    });
    expect(unknown.portionKnown).toBe(false);
    expect(unknown.unit).toBe("g");
    expect(unknown.quantity).toBe(100);
    expect(rowAmountLabel(unknown)).toBe("100 g");
    expect(rowAmountLabel(stepRow(unknown, 1)!)).toBe("125 g");
    expect(row().portionKnown).toBe(true);
  });

  it("treats a zero, negative or non-number quantity as 1", () => {
    for (const quantity of [0, -2, Number.NaN]) {
      const r = row({ quantity });
      expect(r.baseQuantity).toBe(1);
      expect(r.quantity).toBe(1);
    }
  });

  it("gives every row its own id and carries the extra flag", () => {
    const rows = toEntryRows([item(), item({ name: "egg" })], {
      isExtra: true,
      idPrefix: "x",
    });
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
    expect(rows.every((r) => r.isExtra)).toBe(true);
  });
});

describe("stepFor", () => {
  it("steps measured units by a half and counted ones by one", () => {
    expect(stepFor("cup")).toBe(0.5);
    expect(stepFor("Cups")).toBe(0.5);
    expect(stepFor("tablespoon")).toBe(0.5);
    expect(stepFor("oz")).toBe(0.5);
    expect(stepFor("slices")).toBe(1);
    expect(stepFor("large")).toBe(1);
    expect(stepFor("")).toBe(1);
  });

  it("steps gram and millilitre amounts by 25", () => {
    expect(stepFor("g")).toBe(25);
    expect(stepFor("grams")).toBe(25);
    expect(stepFor("ml")).toBe(25);
  });

  it("knows plurals of measured units", () => {
    expect(stepFor("ounces")).toBe(0.5);
    expect(stepFor("glasses")).toBe(0.5);
  });
});

describe("stepRow", () => {
  it("scales calories and weight with the amount", () => {
    const more = stepRow(row(), 1);
    expect(more?.quantity).toBe(4);
    expect(rowCalories(more!)).toBe(Math.round((129 * 4) / 3));
    expect(rowAmountLabel(more!)).toBe("4 slices · 32 g");
  });

  it("removes the row when it would drop below one step", () => {
    expect(stepRow(row({ quantity: 1 }), -1)).toBeNull();
    expect(stepRow(row({ quantity: 0.5, unit: "cup" }), -1)).toBeNull();
  });

  it("stops at 99", () => {
    const top = { ...row(), quantity: 99 };
    expect(stepRow(top, 1)?.quantity).toBe(99);
  });

  it("never produces NaN from a bad starting quantity", () => {
    const more = stepRow(row({ quantity: 0 }), 1)!;
    expect(more.quantity).toBe(2);
    expect(rowCalories(more)).toBe(258);
  });
});

describe("row text", () => {
  it("says so when there is no estimate", () => {
    const r = row({ calories: null, protein: null, carbs: null, fat: null });
    expect(rowCalories(r)).toBeNull();
    expect(rowCaption(r)).toBe("No estimate");
  });

  it("labels an unknown portion as a guess", () => {
    const r = row({ servingSize: "100 g (portion unknown)", quantity: 1 });
    expect(rowCaption(r)).toBe("Portion unknown · 129 kcal");
  });

  it("shows the calories for a known portion", () => {
    expect(rowCaption(row())).toBe("129 kcal");
  });

  it("omits the weight when it is unknown", () => {
    expect(rowAmountLabel(row({ servingSize: "3 slices" }))).toBe("3 slices");
  });

  it("formats halves without trailing zeros", () => {
    expect(formatAmount(1.5)).toBe("1.5");
    expect(formatAmount(2)).toBe("2");
  });
});

describe("entryTotals", () => {
  it("sums scaled rows and rounds each total once", () => {
    const a = row({ calories: 10.4, protein: 1.4, carbs: 0, fat: 0 });
    const b = row({ calories: 10.4, protein: 1.4, carbs: 0, fat: 0 });
    expect(entryTotals([a, b])).toEqual({
      calories: 21,
      protein: 3,
      carbs: 0,
      fat: 0,
    });
  });

  it("counts a missing estimate as zero", () => {
    const none = row({ calories: null, protein: null, carbs: null, fat: null });
    expect(entryTotals([row(), none]).calories).toBe(129);
  });

  it("is all zeros for no rows", () => {
    expect(entryTotals([])).toEqual({
      calories: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
    });
  });
});

describe("retryKey", () => {
  it("changes when a total changes and matches when nothing does", () => {
    const totals = entryTotals([row()]);
    const edited = entryTotals([stepRow(row(), 1)!]);
    expect(retryKey("Bacon", totals)).toBe(retryKey("Bacon", totals));
    expect(retryKey("Bacon", totals)).not.toBe(retryKey("Bacon", edited));
    expect(retryKey("Bacon", totals)).not.toBe(retryKey("Eggs", totals));
  });
});

describe("suggestionsFor", () => {
  it("offers drinks and sides for the meal", () => {
    expect(suggestionsFor("breakfast", [])).toEqual([
      "Coffee",
      "Tea",
      "Orange juice",
      "Toast",
      "Fruit",
    ]);
    expect(suggestionsFor("dinner", [])).toContain("Side salad");
  });

  it("leaves out what is already in the entry", () => {
    const coffee = row({ name: "coffee" });
    expect(suggestionsFor("breakfast", [coffee])).not.toContain("Coffee");
  });
});

describe("exceedsCaps", () => {
  const caps = { calories: 50_000, grams: 5_000 };
  it("is true when any total passes its cap", () => {
    expect(
      exceedsCaps({ calories: 50_001, protein: 0, carbs: 0, fat: 0 }, caps),
    ).toBe(true);
    expect(
      exceedsCaps({ calories: 10, protein: 0, carbs: 5_001, fat: 0 }, caps),
    ).toBe(true);
  });
  it("is false at the cap", () => {
    expect(
      exceedsCaps(
        { calories: 50_000, protein: 5_000, carbs: 5_000, fat: 5_000 },
        caps,
      ),
    ).toBe(false);
  });
});
