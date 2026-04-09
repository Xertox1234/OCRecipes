/**
 * Shared formatting utilities for dates and durations.
 *
 * Consolidates helpers that were previously duplicated across
 * FastingScreen, WeightTrackingScreen, MealPlanHomeScreen,
 * ItemDetailScreen, and GroceryListsScreen.
 */

/** Short date: "Jan 5" */
export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Medium date: "Jan 5, 2024" */
export function formatDateMedium(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Long date with time: "Monday, January 5, 2024, 3:30 PM" */
export function formatDateLong(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** @deprecated Use `toDateString` from `@shared/lib/date` instead. */
export { toDateString as formatDateISO } from "@shared/lib/date";

/** Human-readable duration from minutes: "1h 30m", "45m", "2h" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Date range: "Jan 5 - Jan 12" */
export function formatDateRange(start: string, end: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString("en-US", opts)} - ${e.toLocaleDateString("en-US", opts)}`;
}
