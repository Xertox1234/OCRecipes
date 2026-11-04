import { describe, it, expect } from "vitest";

import {
  formatBatchSaveSuccess,
  formatLogSuccess,
  formatPantryFullSkipped,
} from "../log-success";

describe("formatLogSuccess", () => {
  it("names the calories that were logged", () => {
    expect(formatLogSuccess(320)).toBe("Added · 320 kcal");
  });

  it("rounds to a whole number", () => {
    expect(formatLogSuccess(212.6)).toBe("Added · 213 kcal");
  });

  it("keeps a zero-calorie log", () => {
    expect(formatLogSuccess(0)).toBe("Added · 0 kcal");
  });

  it.each([undefined, null, Number.NaN, Number.POSITIVE_INFINITY, -5])(
    "drops the number when there is no usable calorie count (%s)",
    (kcal) => {
      expect(formatLogSuccess(kcal)).toBe("Added to your log");
    },
  );
});

describe("formatBatchSaveSuccess", () => {
  const items = [
    { calories: 150, quantity: 2 },
    { calories: 90.4, quantity: 1 },
  ];

  it("names the logged calories (calories × quantity) for the daily log", () => {
    expect(formatBatchSaveSuccess(items, "daily_log", "Daily Intake")).toBe(
      "Added · 390 kcal",
    );
  });

  it("counts items for a pantry or grocery save, where calories don't apply", () => {
    expect(formatBatchSaveSuccess(items, "pantry", "Pantry")).toBe(
      "2 items added to Pantry",
    );
    expect(
      formatBatchSaveSuccess([items[0]], "grocery_list", "Grocery List"),
    ).toBe("1 item added to Grocery List");
  });
});

describe("formatPantryFullSkipped", () => {
  it("says how many items were left out", () => {
    expect(formatPantryFullSkipped(3)).toBe(
      "Pantry full: 3 items weren't added",
    );
  });

  it("uses the singular for one item", () => {
    expect(formatPantryFullSkipped(1)).toBe("Pantry full: 1 item wasn't added");
  });
});
