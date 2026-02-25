import { isValidCalendarDate } from "../date-validation";

describe("Date Validation", () => {
  describe("isValidCalendarDate", () => {
    it("accepts valid date 2024-01-15", () => {
      expect(isValidCalendarDate("2024-01-15")).toBe(true);
    });

    it("accepts valid date 2024-12-31", () => {
      expect(isValidCalendarDate("2024-12-31")).toBe(true);
    });

    it("accepts leap year date Feb 29", () => {
      expect(isValidCalendarDate("2024-02-29")).toBe(true);
    });

    it("rejects Feb 29 on non-leap year", () => {
      expect(isValidCalendarDate("2023-02-29")).toBe(false);
    });

    it("rejects invalid month 13", () => {
      expect(isValidCalendarDate("2024-13-01")).toBe(false);
    });

    it("rejects invalid month 00", () => {
      expect(isValidCalendarDate("2024-00-15")).toBe(false);
    });

    it("rejects invalid day 32", () => {
      expect(isValidCalendarDate("2024-01-32")).toBe(false);
    });

    it("rejects invalid day 00", () => {
      expect(isValidCalendarDate("2024-01-00")).toBe(false);
    });

    it("rejects April 31 (April has 30 days)", () => {
      expect(isValidCalendarDate("2024-04-31")).toBe(false);
    });

    it("accepts April 30", () => {
      expect(isValidCalendarDate("2024-04-30")).toBe(true);
    });

    it("rejects Feb 30", () => {
      expect(isValidCalendarDate("2024-02-30")).toBe(false);
    });

    it("accepts Jan 1 boundary", () => {
      expect(isValidCalendarDate("2024-01-01")).toBe(true);
    });

    it("handles year 2000 (leap year)", () => {
      expect(isValidCalendarDate("2000-02-29")).toBe(true);
    });

    it("handles year 1900 (not a leap year)", () => {
      expect(isValidCalendarDate("1900-02-29")).toBe(false);
    });
  });
});
