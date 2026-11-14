import { MEAL_LABELS, type MealType } from "./meal-plan-utils";

/**
 * Success toast copy for "Add to Plan", naming the chosen day and meal so a
 * mis-filed slot (e.g. a local-vs-UTC date bug on write) is visible in the
 * confirmation itself, not just on the Plan tab.
 *
 * Takes `dayLabel` as a plain string (the tapped chip's own `weekday`, e.g.
 * "Wednesday") rather than the `plannedDate` ISO string — do NOT change this
 * to re-derive the day by parsing `plannedDate`. `plannedDate` is the device's
 * LOCAL calendar day, but `new Date(plannedDate)` parses a bare date as UTC
 * midnight, so re-parsing it back into a weekday renders the *previous* day at
 * any UTC-NEGATIVE offset, which would make this toast contradict the very
 * chip the user just tapped. A `plannedDate` must always be built from the
 * device's LOCAL date parts, never `toISOString()` (which is UTC).
 *
 * The sign is a trap: the original write-side bug was UTC-POSITIVE-only, so
 * this guard looks unnecessary when tested from Europe or Oceania. Dropping it
 * breaks the Americas instead.
 */
export function formatPlanSaveSuccess(
  dayLabel: string,
  mealType: MealType,
): string {
  return `Added to ${dayLabel} ${MEAL_LABELS[mealType]}`;
}

/**
 * `formatPlanSaveSuccess` for callers that only hold the ISO `plannedDate`
 * (the meal-plan sheets, recipe browser and wizard). The weekday is rebuilt
 * from the date's parts as a LOCAL date — never `new Date(iso)`, which reads
 * UTC midnight and names the previous day at UTC-negative offsets (see
 * `formatPlanSaveSuccess` above).
 */
export function formatPlanAddSuccess(
  plannedDate: string,
  mealType: string,
): string {
  const [year, month, day] = plannedDate.split("-").map(Number);
  const weekday = new Date(year, month - 1, day).toLocaleDateString("en-US", {
    weekday: "long",
  });
  // Route params type the meal as a plain string; an unknown value still
  // confirms the add, just without a meal label.
  return Object.hasOwn(MEAL_LABELS, mealType)
    ? formatPlanSaveSuccess(weekday, mealType as MealType)
    : `Added to ${weekday}`;
}
