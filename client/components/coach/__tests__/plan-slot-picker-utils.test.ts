import { describe, it, expect } from "vitest";
import { formatDateISO } from "@/lib/format";
import {
  buildPlanSlotDays,
  toPlannedDateSet,
  PLAN_SLOT_MEAL_TYPES,
} from "../plan-slot-picker-utils";

// Local-time constructor (`new Date(y, m, d, h)`), NOT `Date.UTC` — these
// fixtures must represent a fixed LOCAL calendar day/time regardless of the
// host TZ the suite runs under, since that's the whole basis under test.
describe("buildPlanSlotDays", () => {
  it("returns 7 consecutive days starting from the given date", () => {
    const days = buildPlanSlotDays(new Date(2026, 8, 1, 12));
    expect(days).toHaveLength(7);
    expect(days[0].iso).toBe(formatDateISO(new Date(2026, 8, 1)));
    expect(days[6].iso).toBe(formatDateISO(new Date(2026, 8, 7)));
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
    expect(days[6].iso).toBe(formatDateISO(new Date(2026, 9, 4)));
  });

  it("derives iso, dayOfMonth, and the spoken label from the same LOCAL calendar day", () => {
    // Anchored at 23:00 local so a UTC-based implementation (setUTCDate/
    // getUTCDate, timeZone: "UTC") would disagree with the local dayOfMonth/
    // a11yLabel for any TZ where 23:00 local is already past UTC midnight —
    // this pins the local basis at the boundary hour most likely to expose a
    // UTC leak.
    const days = buildPlanSlotDays(new Date(2026, 8, 1, 23));
    expect(days[0].iso).toBe(formatDateISO(new Date(2026, 8, 1)));
    expect(days[0].dayOfMonth).toBe(1);
    expect(days[0].a11yLabel).toContain("September 1");
  });

  // This is the discriminator for the finding: buildPlanSlotDays' `iso` must
  // equal the value MealPlanHomeScreen computes for "today" — i.e.
  // formatDateISO applied to a LOCAL-midnight Date — not `formatDateISO(from)`
  // applied to the raw, unnormalised instant. Mutating this back to
  // `formatDateISO(from)` (dropping the local-midnight normalisation) must
  // fail this test under any UTC-positive TZ (e.g. TZ=Europe/Berlin) at an
  // instant where local time has already crossed into the next UTC day —
  // covered by the 23:00 fixture above; both fixtures pass under
  // TZ=Europe/Berlin, TZ=Pacific/Auckland, and TZ=America/Los_Angeles alike.
  it("[0].iso matches the planner's own 'today' key for the same instant", () => {
    const now = new Date(2026, 8, 1, 23);
    const plannerToday = new Date(now);
    plannerToday.setHours(0, 0, 0, 0);
    const days = buildPlanSlotDays(now);
    expect(days[0].iso).toBe(formatDateISO(plannerToday));
  });
});

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
