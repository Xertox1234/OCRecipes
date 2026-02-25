import {
  formatDateShort,
  formatDateMedium,
  formatDateISO,
  formatDuration,
  formatDateRange,
} from "../format";

describe("Format Utilities", () => {
  describe("formatDateISO", () => {
    it("formats a date as YYYY-MM-DD", () => {
      const date = new Date("2024-01-15T10:30:00Z");
      expect(formatDateISO(date)).toBe("2024-01-15");
    });

    it("formats Jan 1 correctly", () => {
      const date = new Date("2024-01-01T00:00:00Z");
      expect(formatDateISO(date)).toBe("2024-01-01");
    });

    it("formats Dec 31 correctly", () => {
      const date = new Date("2024-12-31T23:59:59Z");
      expect(formatDateISO(date)).toBe("2024-12-31");
    });
  });

  describe("formatDuration", () => {
    it("formats minutes only", () => {
      expect(formatDuration(45)).toBe("45m");
    });

    it("formats hours only", () => {
      expect(formatDuration(120)).toBe("2h");
    });

    it("formats hours and minutes", () => {
      expect(formatDuration(90)).toBe("1h 30m");
    });

    it("formats zero minutes", () => {
      expect(formatDuration(0)).toBe("0m");
    });

    it("formats 1 minute", () => {
      expect(formatDuration(1)).toBe("1m");
    });

    it("formats large durations", () => {
      expect(formatDuration(720)).toBe("12h");
    });

    it("formats 61 minutes", () => {
      expect(formatDuration(61)).toBe("1h 1m");
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
});
