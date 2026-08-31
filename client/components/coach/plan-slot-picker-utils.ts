// Pure date/slot helpers for PlanSlotPickerSheet. Extracted so the date math is
// testable without rendering (the client/components/*-utils.ts convention).
import { toLocalDateString } from "@shared/lib/date";
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
   * ISO `yyyy-mm-dd` — the value sent as `plannedDate`, in the device's LOCAL
   * calendar (see `buildPlanSlotDays`).
   *
   * Still NOT safe to re-parse back into a weekday for display: `new Date(iso)`
   * parses a bare date as UTC **midnight**, which renders as the *previous* day
   * in any UTC-negative zone. Measured for `iso = "2026-09-01"` (a Tuesday):
   * correct in UTC/+2/+12, but `America/Los_Angeles` and `America/Sao_Paulo`
   * both re-parse it as Monday.
   *
   * Note the inversion — the write-side basis bug this file was fixed for was
   * UTC-POSITIVE-only, while this re-parse hazard is UTC-NEGATIVE-only. Knowing
   * one does not warn you about the other.
   *
   * Callers that need the chosen day's name (e.g. a confirmation toast) must
   * carry `weekday` forward from the chip the user actually picked, not
   * recompute it from `iso`.
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
 * `count` consecutive days starting at `from`. Every field — the chip label,
 * the spoken a11y label, AND the `plannedDate` key — is derived from local
 * component getters on the same local-midnight calendar day, so the key a chip
 * writes is always the day that chip is labelled with.
 *
 * `iso` comes from `toLocalDateString`, NOT `toDateString`: a UTC conversion of
 * a local-midnight instant lands one calendar day early for every UTC-positive
 * offset (Berlin, Auckland, Tokyo), which would file every add under a day the
 * user never picked. `MealPlanHomeScreen` — the other reader/writer of the
 * `planned_date` column — uses the same helper on the same basis
 * (`MealPlanHomeScreen.tsx:576`, `:617-618`); the two must move together or the
 * picker silently drifts out of agreement with the planner it feeds.
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
      iso: toLocalDateString(d),
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
