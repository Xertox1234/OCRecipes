/**
 * What the cook-session review screen tells the user about ingredients whose
 * nutrition is incomplete before they log the meal: a missed lookup counts as
 * 0, and a unit with no weight ("6 egg") counts as 100 g.
 */
interface IncompleteNutrition {
  missedLookups: string[];
  /** Absent from an older server's response — treated as empty. */
  unweighedIngredients?: string[];
}

const subject = (names: string[], one: string, many: string) =>
  `${names.join(", ")} ${names.length === 1 ? one : many}`;

/** The "Log anyway?" prompt, or null when nothing needs confirming. */
export function logConfirmMessage(n: IncompleteNutrition): string | null {
  const missed = n.missedLookups;
  const unweighed = n.unweighedIngredients ?? [];
  const parts: string[] = [];
  if (missed.length > 0) {
    parts.push(
      `No nutrition data was found for ${missed.join(", ")}. They will be counted as 0, so the logged meal will be too low.`,
    );
  }
  if (unweighed.length > 0) {
    parts.push(
      `${subject(unweighed, "has", "have")} no weight, so ${unweighed.length === 1 ? "it is" : "they are"} counted as 100 g and the logged meal may be off.`,
    );
  }
  return parts.length > 0 ? `${parts.join(" ")} Log anyway?` : null;
}

/** The warning line under the totals, or null when nothing is missing. */
export function incompleteNutritionNote(n: IncompleteNutrition): string | null {
  const unweighed = n.unweighedIngredients ?? [];
  const parts: string[] = [];
  if (n.missedLookups.length > 0) {
    parts.push(
      `No nutrition data for ${n.missedLookups.join(", ")} (counted as 0)`,
    );
  }
  if (unweighed.length > 0) {
    parts.push(`No weight for ${unweighed.join(", ")} (counted as 100 g)`);
  }
  return parts.length > 0 ? parts.join(" • ") : null;
}
