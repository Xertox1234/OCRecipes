import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  buildPlanSlotDays,
  toPlannedDateSet,
  PLAN_SLOT_MEAL_TYPES,
} from "../plan-slot-picker-utils";

// `plannedDate` is on a DEVICE-LOCAL basis, so these are asserted against
// literal date strings rather than against the helper that produced them (an
// assertion routed back through `toLocalDateString` would pass under any basis).
//
// The zone loop is the regression guard, and it is NOT redundant: CI runs UTC,
// which is the unique zone where a local basis and a UTC basis agree, so a
// guard that only ran there would be silent. Because every fixture is built
// with the local-time constructor `new Date(y, m, d, h)`, a true local basis
// yields the SAME literal in every zone.
//
// Both signs are kept deliberately. Measured failure counts for the two ways
// this can regress:
//
//   mutation                                   UTC  Berlin(+2)  Auckland(+12)  LA(-7)
//   `iso` -> toDateString (keep local midnight)   0       4            4          0
//   full UTC basis on the raw instant             0       1            2          1
//
// So the first shape is caught only by a UTC-POSITIVE zone, while the second is
// caught at either sign. Dropping `America/Los_Angeles` would lose coverage of
// the second shape at negative offsets; dropping Berlin/Auckland would lose the
// first shape entirely. `UTC` is included as the control that must stay green.
// Neither Berlin nor Los_Angeles transitions DST at 00:00 local, so
// `setHours(0,0,0,0)` always lands on a real midnight.
const ZONES = [
  "UTC",
  "Europe/Berlin", // +2 in September
  "Pacific/Auckland", // +12
  "America/Los_Angeles", // -7
] as const;

// Minutes EAST of UTC (`-getTimezoneOffset()`) for each zone above, on the
// September 2026 fixture date used throughout this file. Backs the
// "guards the mechanism" check below — see its comment for why this needs
// to assert a NONZERO offset rather than just any offset.
const ZONE_OFFSET_MINUTES: Record<(typeof ZONES)[number], number> = {
  UTC: 0,
  "Europe/Berlin": 120,
  "Pacific/Auckland": 720,
  "America/Los_Angeles": -420,
};

const originalTz = process.env.TZ;
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe.each(ZONES)("buildPlanSlotDays (TZ=%s)", (tz) => {
  beforeAll(() => {
    process.env.TZ = tz;
  });

  // Guards the pin itself: a silently no-op TZ (a typo'd zone, `TZ=""`, or no
  // pin at all) reads back as offset 0 on a UTC host, which is exactly the
  // failure mode this file exists to catch — so this must assert a NONZERO
  // offset for every zone but the UTC control, or a broken pin would leave
  // every assertion below passing for the wrong reason. See
  // docs/solutions/logic-errors/an-uncontrolled-ambient-input-makes-the-check-agree-with-what-it-checks-2026-08-31.md
  // and .../each-tables-evaluate-before-hooks-so-pinned-env-misses-fixtures-2026-08-31.md.
  it("pins the process timezone this block claims (guards the mechanism)", () => {
    // `+ 0` normalizes negative zero: for the UTC row, the raw offset is `0`,
    // so `-0` (a distinct value from `0` under `toBe`'s `Object.is` semantics)
    // would otherwise fail this assertion even though the pin is correct.
    expect(-new Date(2026, 8, 1).getTimezoneOffset() + 0).toBe(
      ZONE_OFFSET_MINUTES[tz],
    );
  });

  it("returns 7 consecutive days starting from the given date", () => {
    const days = buildPlanSlotDays(new Date(2026, 8, 1, 12));
    expect(days).toHaveLength(7);
    expect(days[0].iso).toBe("2026-09-01");
    expect(days[6].iso).toBe("2026-09-07");
  });

  it("carries a spoken label and a day-of-month for each day", () => {
    const [first] = buildPlanSlotDays(new Date(2026, 8, 1, 12));
    expect(first.dayOfMonth).toBe(1);
    expect(first.a11yLabel).toContain("September");
    expect(first.initial).toHaveLength(1);
  });

  it("carries the full weekday name, consistent with a11yLabel and initial", () => {
    // Sept 1, 2026 is a Tuesday.
    const [first] = buildPlanSlotDays(new Date(2026, 8, 1, 12));
    expect(first.weekday).toBe("Tuesday");
    expect(first.initial).toBe("T");
    expect(first.a11yLabel).toContain("Tuesday");
  });

  it("crosses a month boundary correctly", () => {
    const days = buildPlanSlotDays(new Date(2026, 8, 28, 12));
    expect(days[6].iso).toBe("2026-10-04");
  });

  // The core discriminator. Anchored at 23:00 and 00:30 local — the two hours
  // where a UTC conversion of the local calendar day is most likely to land on
  // a different date (past UTC midnight in a negative-offset zone, still on the
  // previous UTC day in a positive-offset one).
  //
  // The hour is passed as a NUMBER and the Date built inside the test body:
  // `it.each` tables are evaluated at collection time, before `beforeAll` runs,
  // so a Date in the table would be constructed in the host zone and then read
  // back in the pinned one — silently testing neither.
  it.each([
    ["23:00 local", 23, 0],
    ["00:30 local", 0, 30],
  ])(
    "keys iso to the local calendar day, and agrees with dayOfMonth and the spoken label (%s)",
    (_label, hour, minute) => {
      const days = buildPlanSlotDays(new Date(2026, 8, 1, hour, minute));
      expect(days[0].iso).toBe("2026-09-01");
      expect(days[0].dayOfMonth).toBe(1);
      expect(days[0].a11yLabel).toContain("September 1");
    },
  );
});

// NOTE: `describe.each` above leaves process.env.TZ at its last entry
// (America/Los_Angeles) for this block; only the file-level afterAll restores
// it. Harmless — toPlannedDateSet maps strings into a Set with no Date involved,
// so it is timezone-independent — but the inheritance is implicit, so do not add
// a date-sensitive assertion here without pinning a zone of your own.
describe("toPlannedDateSet", () => {
  it("collects the distinct planned dates", () => {
    const set = toPlannedDateSet([
      { plannedDate: "2026-09-01" },
      { plannedDate: "2026-09-01" },
      { plannedDate: "2026-09-03" },
    ]);
    expect(set.has("2026-09-01")).toBe(true);
    expect(set.has("2026-09-03")).toBe(true);
    expect(set.size).toBe(2);
  });

  it("treats undefined as empty", () => {
    expect(toPlannedDateSet(undefined).size).toBe(0);
  });
});

describe("PLAN_SLOT_MEAL_TYPES", () => {
  it("lists all four meal types in serving order", () => {
    expect([...PLAN_SLOT_MEAL_TYPES]).toEqual([
      "breakfast",
      "lunch",
      "dinner",
      "snack",
    ]);
  });
});
