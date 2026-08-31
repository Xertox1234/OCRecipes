/** ISO date string from a Date object: "2024-01-05" */
export function toDateString(date: Date): string {
  return date.toISOString().split("T")[0];
}

/**
 * ISO date string in the **device-local** calendar: "2024-01-05".
 *
 * Reads local component getters rather than converting to UTC, so the result is
 * the day the device itself calls that instant. This is the correct basis for a
 * user-facing calendar key such as `meal_plan_items.planned_date`, where the
 * stored day must match the day the user tapped.
 *
 * **Client-only. Server code must not use this.** On the server "local" is the
 * host's timezone (Railway runs UTC), not the user's, so this silently answers a
 * different question there. Server code that needs a user's civil date must
 * derive it from their IANA timezone instead — `parseTimezone(req.headers
 * ["x-timezone"])` plus the timezone-aware helpers in `server/storage/helpers.ts`.
 *
 * Prefer `toDateString` for anything keyed to an absolute instant (UTC), and
 * this for anything keyed to a calendar day the user picked.
 */
export function toLocalDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
