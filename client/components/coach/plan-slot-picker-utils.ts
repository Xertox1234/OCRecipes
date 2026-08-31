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
  /**
   * ISO `yyyy-mm-dd` — the value sent as `plannedDate`. Because this is
   * `formatDateISO` (UTC-string conversion) applied to a local-midnight
   * instant, it is NOT safe to re-parse back into a weekday for display —
   * for a UTC-positive offset that reparse lands on the wrong day (one
   * earlier than `weekday`/`a11yLabel` below, which come from local
   * component getters on the same instant). Callers that need the chosen
   * day's name for display (e.g. a confirmation toast) must carry `weekday`
   * forward from the chip the user actually picked, not recompute it from
   * `iso`.
   */
  iso: string;
  /** Single-letter weekday initial for the compact chip, e.g. "M". */
  initial: string;
  /** Full weekday name, e.g. "Wednesday" — see the `iso` caveat above. */
  weekday: string;
  /** Day of month, e.g. 1. */
  dayOfMonth: number;
  /** Full spoken label, e.g. "Tuesday, September 1". */
  a11yLabel: string;
}

/**
 * `count` consecutive days starting at `from`. Every field is derived from
 * the same **local-midnight** calendar day (`setHours(0,0,0,0)`, then
 * `setDate`/`getDate`, `toLocaleDateString` with no `timeZone` override) so
 * `iso` — which still comes from `formatDateISO`, i.e.
 * `toISOString().split("T")[0]` — is computed from that same local-midnight
 * instant. This matches `MealPlanHomeScreen`, the other reader/writer of the
 * `planned_date` column: its `today`/`selectedDate` are normalised to local
 * midnight first (`MealPlanHomeScreen.tsx:538-542`) and only then passed
 * through `formatDateISO` (`:572`, `:613-614`). Using a raw `new Date()` or a
 * UTC basis here instead would make this picker key `planned_date` on a
 * different calendar day than the planner's own "today" for the same
 * instant — for any UTC-positive offset (Berlin, Auckland) that mis-files
 * every add under the *next* planner day, 100% of the time; do not swap this
 * back to UTC accessors. (A separate, pre-existing skew between the
 * planner's displayed local day and its UTC-derived `planned_date` key is
 * tracked in `todos/P1-2026-08-30-mealplan-planned-date-shifts-a-day-for-utc-positive-users.md`
 * — not this file's concern; this file only has to agree with the planner's
 * existing basis, not correct it.)
 */
export function buildPlanSlotDays(
  from: Date,
  count: number = PLAN_SLOT_DAY_COUNT,
): PlanSlotDay[] {
  const days: PlanSlotDay[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(from);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + i);
    const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
    days.push({
      iso: formatDateISO(d),
      initial: weekday.charAt(0),
      weekday,
      dayOfMonth: d.getDate(),
      a11yLabel: d.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
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
