import { describe, it, expect } from "vitest";
import { civilDateString, civilDateToInstant } from "../civil-date";
import { getDayBounds } from "../../storage/helpers";

// `getDayBounds` answers "which civil day is this INSTANT in tz". A calendar
// date is not an instant, and the two were being conflated at the route
// boundary: `new Date("2026-09-02")` is UTC midnight, whose civil date in any
// UTC-NEGATIVE zone is the PREVIOUS day. These two helpers name the two
// directions so a caller has to pick one.
//
// No TZ pinning is needed here: every case passes an explicit `tz` argument, so
// the host zone is not an input. That is the point of these helpers.
describe("civilDateString", () => {
  it("reports the civil date of an instant in the target zone", () => {
    // 2026-09-02T00:00Z is still Sept 1 in the Americas.
    const utcMidnight = new Date("2026-09-02T00:00:00Z");
    expect(civilDateString(utcMidnight, "UTC")).toBe("2026-09-02");
    expect(civilDateString(utcMidnight, "Europe/Berlin")).toBe("2026-09-02");
    expect(civilDateString(utcMidnight, "America/Los_Angeles")).toBe(
      "2026-09-01",
    );
    expect(civilDateString(utcMidnight, "America/New_York")).toBe("2026-09-01");
  });

  it("reports the next civil day for an instant already past local midnight", () => {
    // 2026-09-01T22:30Z is 00:30 on Sept 2 in Berlin.
    const evening = new Date("2026-09-01T22:30:00Z");
    expect(civilDateString(evening, "UTC")).toBe("2026-09-01");
    expect(civilDateString(evening, "Europe/Berlin")).toBe("2026-09-02");
    expect(civilDateString(evening, "Pacific/Auckland")).toBe("2026-09-02");
  });

  it("defaults to UTC", () => {
    expect(civilDateString(new Date("2026-09-02T00:00:00Z"))).toBe(
      "2026-09-02",
    );
  });
});

describe("civilDateToInstant", () => {
  // The round-trip is the contract: for EVERY zone, an instant produced for
  // civil day D must read back as civil day D. This is precisely what
  // `new Date("YYYY-MM-DD")` fails to guarantee.
  // The last three are the zones that CAN reach the DST clamp in
  // `civilMidnightUtcMs`, but note these particular dates do not — none is a
  // transition day, so they add zone diversity, not clamp coverage. The clamp
  // is covered by the dedicated fixtures below, each verified non-vacuous by
  // deleting the loop (all four then fail).
  it.each([
    "UTC",
    "Europe/Berlin",
    "Pacific/Auckland",
    "Pacific/Kiritimati",
    "America/Los_Angeles",
    "America/New_York",
    "Asia/Kolkata",
    "America/Santiago",
    "America/Havana",
    "Atlantic/Azores",
  ])("round-trips a civil date through %s", (tz) => {
    for (const dateStr of ["2026-09-02", "2026-01-01", "2026-12-31"]) {
      expect(civilDateString(civilDateToInstant(dateStr, tz), tz)).toBe(
        dateStr,
      );
    }
  });

  it("lands on local midnight, so getDayBounds recovers the same civil day", () => {
    for (const tz of ["Europe/Berlin", "America/Los_Angeles", "UTC"]) {
      const { startOfDay, endOfDay } = getDayBounds(
        civilDateToInstant("2026-09-02", tz),
        tz,
      );
      expect(civilDateString(startOfDay, tz)).toBe("2026-09-02");
      expect(civilDateString(endOfDay, tz)).toBe("2026-09-02");
    }
  });

  it("is NOT the same as new Date(dateStr) for a UTC-negative zone", () => {
    // The defect in one line: the naive parse reads back as the previous day.
    const tz = "America/Los_Angeles";
    expect(civilDateString(new Date("2026-09-02"), tz)).toBe("2026-09-01");
    expect(civilDateString(civilDateToInstant("2026-09-02", tz), tz)).toBe(
      "2026-09-02",
    );
  });

  it("handles a spring-forward day whose local midnight exists", () => {
    // US DST starts 2026-03-08 at 02:00 local; midnight itself is unaffected.
    const tz = "America/Los_Angeles";
    expect(civilDateString(civilDateToInstant("2026-03-08", tz), tz)).toBe(
      "2026-03-08",
    );
  });

  // Every zone/day that actually reaches the clamp, 2024-2027. Verified
  // non-vacuous: deleting the clamp makes each of these return the PREVIOUS
  // day. `Asia/Beirut` also transitions at 00:00 but is UTC-positive
  // beforehand, so it lands on the right day unaided — it belongs in neither
  // this list nor a regression fixture.
  it.each([
    ["America/Santiago", "2026-09-06"],
    ["America/Havana", "2026-03-08"],
    ["Atlantic/Azores", "2026-03-29"],
    ["America/Asuncion", "2024-10-06"],
  ])("handles %s %s, where local midnight does not exist", (tz, dateStr) => {
    expect(civilDateString(civilDateToInstant(dateStr, tz), tz)).toBe(dateStr);
  });

  it("defaults to UTC", () => {
    expect(civilDateToInstant("2026-09-02").toISOString()).toBe(
      "2026-09-02T00:00:00.000Z",
    );
  });

  // `Antarctica/Troll` shifts by TWO hours (UTC+0 <-> UTC+2), so its fall-back
  // day is 26 hours long. `getDayBounds` used to find "tomorrow" by adding 25h
  // and reading the civil date, which landed back inside the SAME day: the
  // bounds came out inverted (endOfDay one millisecond before startOfDay) and
  // every query for that day silently returned nothing. Tomorrow is now derived
  // from the calendar, which is exact for any transition magnitude.
  it("produces forward bounds on a 26-hour local day (2h DST shift)", () => {
    const tz = "Antarctica/Troll";
    for (const dateStr of ["2026-10-25", "2025-10-26", "2024-10-27"]) {
      const { startOfDay, endOfDay } = getDayBounds(
        civilDateToInstant(dateStr, tz),
        tz,
      );
      expect(endOfDay.getTime()).toBeGreaterThan(startOfDay.getTime());
      expect(civilDateString(startOfDay, tz)).toBe(dateStr);
      expect(civilDateString(endOfDay, tz)).toBe(dateStr);
      // The day really is 26h long, which is what broke the old heuristic.
      expect(endOfDay.getTime() - startOfDay.getTime()).toBe(
        26 * 60 * 60 * 1000 - 1,
      );
    }
  });
});
