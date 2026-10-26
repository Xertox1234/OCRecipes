/**
 * Shared formatting utilities for dates and durations.
 *
 * Consolidates helpers that were previously duplicated across
 * MealPlanHomeScreen, ItemDetailScreen, and GroceryListsScreen.
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

/** Human-readable duration from minutes: "1 hr 30 min", "45 min", "2 hr" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

/** Date range: "Jan 5 - Jan 12" */
export function formatDateRange(start: string, end: string): string {
  const s = new Date(start + "T00:00:00");
  const e = new Date(end + "T00:00:00");
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  return `${s.toLocaleDateString("en-US", opts)} - ${e.toLocaleDateString("en-US", opts)}`;
}

/** One local-calendar date for people: "Mon, Oct 27". */
export function formatDateWithWeekday(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/**
 * Generated grocery-list titles embed raw ISO dates
 * ("Grocery List 2024-01-05 to 2024-01-12", written by server/routes/grocery.ts).
 * Render those as "Grocery List Jan 5 - Jan 12"; any other title passes through.
 */
export function formatGroceryListTitle(title: string): string {
  const match =
    /^Grocery List (\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})$/.exec(title);
  if (!match) return title;
  return `Grocery List ${formatDateRange(match[1], match[2])}`;
}

/**
 * "200 g spaghetti" from an ingredient's parts. A blank unit or quantity is
 * dropped with its space, so a unitless "1 lemon" never prints "1  lemon".
 */
export function formatIngredientLine(
  quantity: string | number | null | undefined,
  unit: string | null | undefined,
  name: string,
): string {
  return [quantity, unit, name]
    .map((part) => (part == null ? "" : String(part).trim()))
    .filter(Boolean)
    .join(" ");
}
