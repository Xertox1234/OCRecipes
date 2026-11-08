/**
 * Notebook entry types the coach writes for itself — recaps of past chats
 * and notes on how to coach — as opposed to facts about the user.
 */
const COACH_NOTE_TYPES: ReadonlySet<string> = new Set([
  "conversation_summary",
  "coaching_strategy",
]);

/**
 * Splits the "All" list: the user's own entries stay in the list, the
 * coach's notes go to their own folded section (owner ruling 2026-11-08).
 */
export function splitCoachNotes<T extends { type: string }>(
  entries: readonly T[],
): { mine: T[]; coachNotes: T[] } {
  const mine: T[] = [];
  const coachNotes: T[] = [];
  for (const entry of entries) {
    (COACH_NOTE_TYPES.has(entry.type) ? coachNotes : mine).push(entry);
  }
  return { mine, coachNotes };
}
