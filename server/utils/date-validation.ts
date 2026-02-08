/**
 * Validate that a YYYY-MM-DD string represents a real calendar date.
 * The regex format check must happen before calling this function.
 * Rejects values like "2024-13-45" or "2024-02-30".
 */
export function isValidCalendarDate(dateStr: string): boolean {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}
