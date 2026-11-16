import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { toLocalDateString } from "@shared/lib/date";

import { getWeekDates } from "../week-grid-utils";

// Kept apart from week-grid-utils.test.ts on purpose. This block pins the
// process timezone, and that pin only takes effect in a forked test process.
// The mutation runner (Stryker) runs a module's dedicated `<module>.test.ts`
// in worker threads, where assigning `process.env.TZ` does not change the
// timezone, so the guard test below fails and aborts the whole mutation run.
// A sibling file with its own suffix stays out of that run, the same way
// `*.property.test.ts` files do.

describe("getWeekDates on a UTC-positive device", () => {
  const originalTz = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "Europe/Berlin";
  });

  afterAll(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("pins the timezone it claims to (guards the mechanism)", () => {
    expect(-new Date(2026, 10, 18).getTimezoneOffset()).toBe(60);
  });

  it("still returns the local calendar days, not the UTC ones", () => {
    // 00:30 local on the 18th is still the 17th in UTC.
    const dates = getWeekDates(new Date(2026, 10, 18, 0, 30));
    expect(dates.map(toLocalDateString)).toEqual([
      "2026-11-15",
      "2026-11-16",
      "2026-11-17",
      "2026-11-18",
      "2026-11-19",
      "2026-11-20",
      "2026-11-21",
    ]);
  });
});
