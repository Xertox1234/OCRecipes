/** Escape ILIKE metacharacters so user input is treated as literal text. */
export function escapeLike(str: string): string {
  return str.replace(/[%_\\]/g, "\\$&");
}

/**
 * Returns the start (00:00:00.000) and end (23:59:59.999) of the given day.
 * Replaces 8+ duplicated date-range blocks throughout the storage layer.
 */
export function getDayBounds(date: Date): {
  startOfDay: Date;
  endOfDay: Date;
} {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);
  return { startOfDay, endOfDay };
}
