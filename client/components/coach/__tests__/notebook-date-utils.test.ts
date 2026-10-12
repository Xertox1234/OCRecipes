import { addDaysToISO, formatFollowUpDate } from "../notebook-date-utils";

describe("addDaysToISO", () => {
  const today = new Date(2026, 9, 12); // 2026-10-12 local

  it("counts from today when there is no date yet", () => {
    expect(addDaysToISO(null, 1, today)).toBe("2026-10-13");
    expect(addDaysToISO(null, 7, today)).toBe("2026-10-19");
  });

  it("counts from the existing date", () => {
    expect(addDaysToISO("2026-10-30", 3, today)).toBe("2026-11-02");
    expect(addDaysToISO("2026-10-30", -1, today)).toBe("2026-10-29");
  });

  it("never goes earlier than today", () => {
    expect(addDaysToISO("2026-10-12", -1, today)).toBe("2026-10-12");
    expect(addDaysToISO(null, -5, today)).toBe("2026-10-12");
  });
});

describe("formatFollowUpDate", () => {
  it("formats a stored date for display", () => {
    expect(formatFollowUpDate("2026-10-13")).toMatch(/Oct/);
    expect(formatFollowUpDate("2026-10-13")).toMatch(/13/);
  });

  it("returns a placeholder when empty or malformed", () => {
    expect(formatFollowUpDate(null)).toBe("No date");
    expect(formatFollowUpDate("nope")).toBe("No date");
  });
});
