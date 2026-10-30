import {
  addDaysToISO,
  formatFollowUpDate,
  storedFollowUpToCivilDate,
} from "../notebook-date-utils";

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

describe("storedFollowUpToCivilDate (R27)", () => {
  // The server stores a follow-up day as LOCAL midnight in the user's zone
  // (civilDateToInstant). For a UTC+ user that instant falls on the previous UTC
  // day, so reading it back via toISOString().slice(0, 10) shows (and re-saves)
  // the day before. Run in a UTC+ zone so the UTC-slice bug is observable.
  const originalTZ = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "Australia/Sydney";
  });
  afterAll(() => {
    process.env.TZ = originalTZ;
  });

  it("reads a stored local-midnight instant back as the same civil day", () => {
    // Built from the zone the runner actually applied: assigning process.env.TZ
    // takes effect in vitest's forked workers but not in every runner (Stryker's
    // dry run keeps the host zone), so a hard-coded Sydney instant would only
    // hold in some of them. Under Sydney (UTC+11) this instant is
    // 2026-10-30T13:00:00.000Z, which the old UTC slice read as the 30th.
    const stored = new Date(2026, 9, 31, 0, 0).toISOString();
    expect(storedFollowUpToCivilDate(stored)).toBe("2026-10-31");
  });

  it("round-trips without drifting a day per edit", () => {
    const stored = new Date(2026, 9, 31).toISOString(); // local midnight
    expect(storedFollowUpToCivilDate(stored)).toBe("2026-10-31");
  });

  it("returns null for no date", () => {
    expect(storedFollowUpToCivilDate(null)).toBeNull();
    expect(storedFollowUpToCivilDate(undefined)).toBeNull();
  });
});
