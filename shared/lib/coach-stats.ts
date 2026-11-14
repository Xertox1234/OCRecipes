/**
 * Pure helpers for Coach day stats and notebook tips, shared by the server
 * (opening brief) and the client.
 */

/** Case, spacing and a closing full stop don't make a different tip. */
export function insightKey(content: string): string {
  return content
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?]+$/, "");
}

/** Shorter than this, one tip containing another is coincidence, not a copy. */
const MIN_CONTAINED_LENGTH = 20;

export function sameTip(a: string, b: string): boolean {
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return shorter.length >= MIN_CONTAINED_LENGTH && longer.includes(shorter);
}

/**
 * The first `limit` insights, each saying something different. The notebook
 * stores a fact again whenever a later turn re-learns it, so the newest
 * entries can repeat one another word for word, or with a clause added.
 */
export function selectTopInsights<T extends { type: string; content: string }>(
  notebook: readonly T[],
  limit = 2,
): T[] {
  const keys: string[] = [];
  const picked: T[] = [];
  for (const entry of notebook) {
    if (entry.type !== "insight") continue;
    const key = insightKey(entry.content);
    if (keys.some((k) => sameTip(k, key))) continue;
    keys.push(key);
    picked.push(entry);
    if (picked.length === limit) break;
  }
  return picked;
}

/**
 * The calories tile: what is left of the goal, or how far past it, as a
 * whole, grouped number ("2,080") to match the top row.
 */
export function remainingCaloriesStat(
  goalCalories: number,
  consumedCalories: number,
): { value: string; label: "Remaining" | "Over" } {
  // `+ 0` turns the -0 from rounding a hair over the goal into 0, which
  // would otherwise take the Remaining branch and print as "-0".
  const left = Math.round(goalCalories - consumedCalories) + 0;
  return left < 0
    ? { value: (-left).toLocaleString(), label: "Over" }
    : { value: left.toLocaleString(), label: "Remaining" };
}
