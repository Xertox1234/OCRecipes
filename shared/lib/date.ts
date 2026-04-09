/** ISO date string from a Date object: "2024-01-05" */
export function toDateString(date: Date): string {
  return date.toISOString().split("T")[0];
}
