import { describe, it, expect } from "vitest";
import {
  buildPlanSlotDays,
  toPlannedDateSet,
  PLAN_SLOT_MEAL_TYPES,
} from "../plan-slot-picker-utils";

describe("buildPlanSlotDays", () => {
  it("returns 7 consecutive days starting from the given date", () => {
    const days = buildPlanSlotDays(new Date(Date.UTC(2026, 8, 1, 12)));
    expect(days).toHaveLength(7);
    expect(days[0].iso).toBe("2026-09-01");
    expect(days[6].iso).toBe("2026-09-07");
  });

  it("carries a spoken label and a day-of-month for each day", () => {
    const [first] = buildPlanSlotDays(new Date(Date.UTC(2026, 8, 1, 12)));
    expect(first.dayOfMonth).toBe(1);
    expect(first.a11yLabel).toContain("September");
    expect(first.initial).toHaveLength(1);
  });

  it("crosses a month boundary correctly", () => {
    const days = buildPlanSlotDays(new Date(Date.UTC(2026, 8, 28, 12)));
    expect(days[6].iso).toBe("2026-10-04");
  });

  it("derives iso, dayOfMonth, and the spoken label from the same UTC calendar day", () => {
    // Anchored at 23:00 UTC so a local-time implementation (setDate/getDate)
    // would disagree with the UTC-based iso from formatDateISO — this is the
    // discriminator for the UTC-vs-local mixing bug: TZ=Pacific/Auckland is
    // UTC+13, so at this instant the local date is already the next day.
    const days = buildPlanSlotDays(new Date(Date.UTC(2026, 8, 1, 23)));
    expect(days[0].iso).toBe("2026-09-01");
    expect(days[0].dayOfMonth).toBe(1);
    expect(days[0].a11yLabel).toContain("September 1");
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
