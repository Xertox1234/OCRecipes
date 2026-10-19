import {
  formatDateShort,
  formatDateMedium,
  formatDuration,
  formatDateRange,
  formatGroceryListTitle,
  formatIngredientLine,
} from "../format";

describe("Format Utilities", () => {
  describe("formatDuration", () => {
    it("formats minutes only", () => {
      expect(formatDuration(45)).toBe("45 min");
    });

    it("formats hours only", () => {
      expect(formatDuration(120)).toBe("2 hr");
    });

    it("formats hours and minutes", () => {
      expect(formatDuration(90)).toBe("1 hr 30 min");
    });

    it("formats zero minutes", () => {
      expect(formatDuration(0)).toBe("0 min");
    });

    it("formats 1 minute", () => {
      expect(formatDuration(1)).toBe("1 min");
    });

    it("formats large durations", () => {
      expect(formatDuration(720)).toBe("12 hr");
    });

    it("formats 61 minutes", () => {
      expect(formatDuration(61)).toBe("1 hr 1 min");
    });
  });

  describe("formatDateShort", () => {
    it("returns short date format with month and day", () => {
      const result = formatDateShort("2024-01-15T12:00:00");
      // Should contain "Jan" for January
      expect(result).toContain("Jan");
    });
  });

  describe("formatDateMedium", () => {
    it("returns medium date format with year", () => {
      const result = formatDateMedium("2024-01-15T12:00:00");
      expect(result).toContain("Jan");
      expect(result).toContain("2024");
    });
  });

  describe("formatDateRange", () => {
    it("formats a date range", () => {
      const result = formatDateRange("2024-01-05", "2024-01-12");
      // Should contain both days
      expect(result).toContain("5");
      expect(result).toContain("12");
      expect(result).toContain("-");
    });
  });

  describe("formatGroceryListTitle", () => {
    it("rewrites a generated ISO-date title as a readable range", () => {
      const result = formatGroceryListTitle(
        "Grocery List 2024-01-05 to 2024-01-12",
      );
      expect(result).toContain("Grocery List");
      expect(result).toContain("Jan 5");
      expect(result).toContain("Jan 12");
      expect(result).not.toContain("2024-01-05");
    });

    it("leaves a user-chosen title untouched", () => {
      expect(formatGroceryListTitle("Party shopping")).toBe("Party shopping");
    });
  });

  // QA #19: JSX `{quantity} {unit} {name}` printed "1  lemon" for a blank unit.
  describe("formatIngredientLine", () => {
    it("joins quantity, unit and name with single spaces", () => {
      expect(formatIngredientLine("200", "g", "spaghetti")).toBe(
        "200 g spaghetti",
      );
    });

    it("drops a blank or missing unit without a double space", () => {
      expect(formatIngredientLine("1", "", "lemon")).toBe("1 lemon");
      expect(formatIngredientLine("1", "  ", "lemon")).toBe("1 lemon");
      expect(formatIngredientLine(1, null, "lemon")).toBe("1 lemon");
    });

    it("drops a missing quantity without a leading space", () => {
      expect(formatIngredientLine(undefined, undefined, "salt")).toBe("salt");
      expect(formatIngredientLine("", "pinch", "salt")).toBe("pinch salt");
    });
  });
});
