import { describe, it, expect } from "vitest";
import {
  escapeLike,
  getDayBounds,
  getMonthBounds,
  civilDateString,
  civilDateToInstant,
} from "../helpers";

describe("escapeLike", () => {
  it("escapes percent sign", () => {
    expect(escapeLike("100%")).toBe("100\\%");
  });

  it("escapes underscore", () => {
    expect(escapeLike("hello_world")).toBe("hello\\_world");
  });

  it("escapes backslash", () => {
    expect(escapeLike("path\\to")).toBe("path\\\\to");
  });

  it("escapes multiple metacharacters", () => {
    expect(escapeLike("50%_off\\sale")).toBe("50\\%\\_off\\\\sale");
  });

  it("returns unchanged string with no metacharacters", () => {
    expect(escapeLike("hello world")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(escapeLike("")).toBe("");
  });

  it("handles string of only metacharacters", () => {
    expect(escapeLike("%_\\")).toBe("\\%\\_\\\\");
  });
});

describe("getDayBounds", () => {
  it("returns start of day at UTC midnight", () => {
    const date = new Date("2024-06-15T14:30:45.500Z");
    const { startOfDay } = getDayBounds(date);

    expect(startOfDay.getUTCHours()).toBe(0);
    expect(startOfDay.getUTCMinutes()).toBe(0);
    expect(startOfDay.getUTCSeconds()).toBe(0);
    expect(startOfDay.getUTCMilliseconds()).toBe(0);
  });

  it("returns end of day at UTC 23:59:59.999", () => {
    const date = new Date("2024-06-15T14:30:45.500Z");
    const { endOfDay } = getDayBounds(date);

    expect(endOfDay.getUTCHours()).toBe(23);
    expect(endOfDay.getUTCMinutes()).toBe(59);
    expect(endOfDay.getUTCSeconds()).toBe(59);
    expect(endOfDay.getUTCMilliseconds()).toBe(999);
  });

  it("preserves the UTC date (year, month, day)", () => {
    const date = new Date("2024-12-25T08:00:00Z");
    const { startOfDay, endOfDay } = getDayBounds(date);

    expect(startOfDay.getUTCFullYear()).toBe(2024);
    expect(startOfDay.getUTCMonth()).toBe(11);
    expect(startOfDay.getUTCDate()).toBe(25);
    expect(endOfDay.getUTCFullYear()).toBe(2024);
    expect(endOfDay.getUTCMonth()).toBe(11);
    expect(endOfDay.getUTCDate()).toBe(25);
  });

  it("does not mutate the input date", () => {
    const date = new Date("2024-06-15T14:30:45.500Z");
    const originalTime = date.getTime();
    getDayBounds(date);
    expect(date.getTime()).toBe(originalTime);
  });

  it("handles UTC midnight input", () => {
    const date = new Date("2024-01-01T00:00:00.000Z");
    const { startOfDay, endOfDay } = getDayBounds(date);

    expect(startOfDay.getUTCHours()).toBe(0);
    expect(endOfDay.getUTCHours()).toBe(23);
  });

  // Timezone-aware tests (AC: non-UTC user across local-midnight boundary)

  it("LA 11pm UTC = same calendar day in LA, not next day in UTC", () => {
    // 2026-05-30T06:00:00Z = 2026-05-29T23:00:00 in America/Los_Angeles (UTC-7)
    const date = new Date("2026-05-30T06:00:00Z");
    const { startOfDay, endOfDay } = getDayBounds(date, "America/Los_Angeles");

    // Should bound May 29 LA time: 07:00Z–06:59:59.999Z next day
    expect(startOfDay.toISOString()).toBe("2026-05-29T07:00:00.000Z");
    expect(endOfDay.toISOString()).toBe("2026-05-30T06:59:59.999Z");
  });

  it("UTC default still gives UTC day bounds", () => {
    const date = new Date("2026-05-30T06:00:00Z");
    const { startOfDay, endOfDay } = getDayBounds(date, "UTC");

    expect(startOfDay.toISOString()).toBe("2026-05-30T00:00:00.000Z");
    expect(endOfDay.toISOString()).toBe("2026-05-30T23:59:59.999Z");
  });

  it("India (UTC+5:30) 1am is still same local calendar day", () => {
    // 2026-05-29T19:30:00Z = 2026-05-30T01:00:00 in Asia/Kolkata (UTC+5:30)
    const date = new Date("2026-05-29T19:30:00Z");
    const { startOfDay, endOfDay } = getDayBounds(date, "Asia/Kolkata");

    // May 30 in IST starts at 2026-05-29T18:30:00Z
    expect(startOfDay.toISOString()).toBe("2026-05-29T18:30:00.000Z");
    expect(endOfDay.toISOString()).toBe("2026-05-30T18:29:59.999Z");
  });

  it("does not mutate the input date when tz is provided", () => {
    const date = new Date("2026-05-30T06:00:00Z");
    const originalTime = date.getTime();
    getDayBounds(date, "America/Los_Angeles");
    expect(date.getTime()).toBe(originalTime);
  });

  // DST correctness — spring-forward regression
  it("DST spring-forward: input at 1pm PDT gives correct midnight (PST, not PDT)", () => {
    // 2026-03-08: LA springs forward at 2am. Midnight Mar 8 = PST (UTC-8) = 08:00Z.
    // Sampling the offset at 1pm PDT (20:00Z, UTC-7) would give the wrong offset
    // and compute 07:00Z. The two-step correction must produce 08:00Z.
    const date = new Date("2026-03-08T20:00:00Z"); // 1pm PDT
    const { startOfDay, endOfDay } = getDayBounds(date, "America/Los_Angeles");

    expect(startOfDay.toISOString()).toBe("2026-03-08T08:00:00.000Z");
    // Spring-forward day is 23h: ends at 2026-03-09T06:59:59.999Z (midnight PDT)
    expect(endOfDay.toISOString()).toBe("2026-03-09T06:59:59.999Z");
  });

  it("DST fall-back: 25-hour day ends at the correct UTC instant", () => {
    // 2026-11-01: LA falls back at 2am. Start = midnight PDT (07:00Z).
    // End = midnight PST on Nov 2 - 1ms = 08:00:00Z - 1ms = 07:59:59.999Z.
    const date = new Date("2026-11-01T10:00:00Z"); // some time Nov 1 LA
    const { startOfDay, endOfDay } = getDayBounds(date, "America/Los_Angeles");

    expect(startOfDay.toISOString()).toBe("2026-11-01T07:00:00.000Z");
    expect(endOfDay.toISOString()).toBe("2026-11-02T07:59:59.999Z");
  });
});

describe("getMonthBounds", () => {
  it("returns UTC month bounds with default tz", () => {
    const date = new Date("2026-05-15T12:00:00Z");
    const { startOfMonth, endOfMonth } = getMonthBounds(date);

    expect(startOfMonth.toISOString()).toBe("2026-05-01T00:00:00.000Z");
    // May has 31 days — end is May 31 23:59:59.999 UTC
    expect(endOfMonth.toISOString()).toBe("2026-05-31T23:59:59.999Z");
  });

  it("returns month bounds in LA timezone", () => {
    // 2026-05-31T23:00:00Z = 2026-05-31T16:00 LA (UTC-7) — still May in LA
    const date = new Date("2026-05-31T23:00:00Z");
    const { startOfMonth, endOfMonth } = getMonthBounds(
      date,
      "America/Los_Angeles",
    );

    // May 1 in LA = 2026-05-01T07:00:00Z
    expect(startOfMonth.toISOString()).toBe("2026-05-01T07:00:00.000Z");
    // May 31 23:59:59.999 LA = 2026-06-01T06:59:59.999Z
    expect(endOfMonth.toISOString()).toBe("2026-06-01T06:59:59.999Z");
  });
});

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
  it.each([
    "UTC",
    "Europe/Berlin",
    "Pacific/Auckland",
    "Pacific/Kiritimati",
    "America/Los_Angeles",
    "America/New_York",
    "Asia/Kolkata",
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

  it("handles a zone whose DST transition is AT midnight (no 00:00 that day)", () => {
    // America/Santiago springs forward at 00:00 local, so local midnight does
    // not exist on the transition day. The civil date must still round-trip.
    const tz = "America/Santiago";
    expect(civilDateString(civilDateToInstant("2026-09-06", tz), tz)).toBe(
      "2026-09-06",
    );
  });

  it("defaults to UTC", () => {
    expect(civilDateToInstant("2026-09-02").toISOString()).toBe(
      "2026-09-02T00:00:00.000Z",
    );
  });
});
