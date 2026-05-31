import { describe, it, expect } from "vitest";
import { escapeLike, getDayBounds, getMonthBounds } from "../helpers";

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
