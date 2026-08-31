import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { toDateString, toLocalDateString } from "../date";

describe("toDateString", () => {
  it("formats a date as YYYY-MM-DD", () => {
    expect(toDateString(new Date("2024-01-05T12:00:00Z"))).toBe("2024-01-05");
  });

  it("handles start of day UTC", () => {
    expect(toDateString(new Date("2024-06-15T00:00:00Z"))).toBe("2024-06-15");
  });

  it("handles end of day UTC", () => {
    expect(toDateString(new Date("2024-12-31T23:59:59Z"))).toBe("2024-12-31");
  });

  it("uses UTC date (not local timezone)", () => {
    // Date just past midnight UTC — should always be the UTC date
    const date = new Date("2024-03-01T00:30:00Z");
    expect(toDateString(date)).toBe("2024-03-01");
  });

  it("handles leap year date", () => {
    expect(toDateString(new Date("2024-02-29T10:00:00Z"))).toBe("2024-02-29");
  });
});

// `toLocalDateString` is a DEVICE-LOCAL basis, so a test that runs in UTC cannot
// tell it apart from `toDateString` — UTC is the unique zone where the two agree.
// CI runs UTC, so these tests pin a zone explicitly. ANY nonzero offset
// discriminates; the sign is irrelevant (both are covered below precisely so
// nobody "corrects" one of them into a same-sign pair). `Europe/Berlin` and
// `America/Los_Angeles` are chosen because neither transitions DST at 00:00
// local, so `setHours(0,0,0,0)` always lands on a real midnight.
describe("toLocalDateString", () => {
  const originalTz = process.env.TZ;
  const setTz = (tz: string) => {
    process.env.TZ = tz;
  };
  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  describe("in a UTC-positive zone (Europe/Berlin, +2 in September)", () => {
    beforeAll(() => setTz("Europe/Berlin"));

    it("pins the timezone it claims to (guards the mechanism, not the code)", () => {
      expect(-new Date(2026, 8, 2).getTimezoneOffset()).toBe(120);
    });

    it("returns the LOCAL calendar day for a local-midnight instant", () => {
      expect(toLocalDateString(new Date(2026, 8, 2))).toBe("2026-09-02");
    });

    it("differs from toDateString, which reports the UTC day of that instant", () => {
      expect(toDateString(new Date(2026, 8, 2))).toBe("2026-09-01");
    });

    it("returns the local day for an after-midnight instant still on the previous UTC day", () => {
      expect(toLocalDateString(new Date(2026, 8, 2, 1, 30))).toBe("2026-09-02");
    });
  });

  describe("in a UTC-negative zone (America/Los_Angeles, -7 in September)", () => {
    beforeAll(() => setTz("America/Los_Angeles"));

    it("pins the timezone it claims to", () => {
      expect(-new Date(2026, 8, 2).getTimezoneOffset()).toBe(-420);
    });

    it("returns the local day for a late-evening instant already on the next UTC day", () => {
      expect(toLocalDateString(new Date(2026, 8, 2, 23, 30))).toBe(
        "2026-09-02",
      );
      expect(toDateString(new Date(2026, 8, 2, 23, 30))).toBe("2026-09-03");
    });
  });

  describe("formatting", () => {
    beforeAll(() => setTz("Europe/Berlin"));

    it("zero-pads single-digit months and days", () => {
      expect(toLocalDateString(new Date(2026, 0, 5))).toBe("2026-01-05");
    });

    it("handles a leap day", () => {
      expect(toLocalDateString(new Date(2024, 1, 29))).toBe("2024-02-29");
    });

    it("handles a year boundary", () => {
      expect(toLocalDateString(new Date(2026, 11, 31, 23, 59))).toBe(
        "2026-12-31",
      );
    });
  });
});
