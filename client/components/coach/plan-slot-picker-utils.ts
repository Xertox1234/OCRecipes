// Pure date/slot helpers for PlanSlotPickerSheet. Extracted so the date math is
// testable without rendering (the client/components/*-utils.ts convention).
import { formatDateISO } from "@/lib/format";
import type { MealType } from "@/screens/meal-plan/meal-plan-utils";

export const PLAN_SLOT_DAY_COUNT = 7;

export const PLAN_SLOT_MEAL_TYPES: readonly MealType[] = [
  "breakfast",
  "lunch",
  "dinner",
  "snack",
] as const;

export interface PlanSlotDay {
  /** ISO `yyyy-mm-dd` — the value sent as `plannedDate`. */
  iso: string;
  /** Single-letter weekday initial for the compact chip, e.g. "M". */
  initial: string;
  /** Day of month, e.g. 1. */
  dayOfMonth: number;
  /** Full spoken label, e.g. "Tuesday, September 1". */
  a11yLabel: string;
}

/**
 * `count` consecutive days starting at `from`. Every field is derived from the
 * same UTC calendar day (`setUTCDate`/`getUTCDate`, `toLocaleDateString` with
 * `timeZone: "UTC"`) so `iso` — which comes from `formatDateISO`, itself
 * `toISOString().split("T")[0]` and therefore UTC — can never disagree with
 * the day-of-month or spoken label shown on the same chip. Mixing a
 * local-time basis (bare `setDate`/`getDate`) with the UTC `iso` would let a
 * chip visually read "Sat 30" while its `iso` (and therefore the
 * `plannedDate` sent to `onConfirm`) is already "Sun 31" for any caller west
 * of UTC in the evening, or east of UTC in the early morning — a mis-filed
 * plan slot, not just a cosmetic mismatch. Matches `MealPlanHomeScreen`'s use
 * of the same `formatDateISO` helper; do not "fix" this to local time.
 */
export function buildPlanSlotDays(
  from: Date,
  count: number = PLAN_SLOT_DAY_COUNT,
): PlanSlotDay[] {
  const days: PlanSlotDay[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() + i);
    days.push({
      iso: formatDateISO(d),
      initial: d
        .toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" })
        .charAt(0),
      dayOfMonth: d.getUTCDate(),
      a11yLabel: d.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        timeZone: "UTC",
      }),
    });
  }
  return days;
}

/** The set of dates that already have plan items — drives the "has items" dot. */
export function toPlannedDateSet(
  items: { plannedDate: string }[] | undefined,
): Set<string> {
  return new Set((items ?? []).map((i) => i.plannedDate));
}
