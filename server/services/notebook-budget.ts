/**
 * Notebook Budget Service
 *
 * Pure helpers for truncating notebook entries to a character budget when
 * injecting them into the Coach Pro system prompt. Kept as pure functions so
 * they can be unit-tested without mocking the storage or AI layers.
 *
 * Extracted from `server/services/coach-pro-chat.ts` during the Coach Pro
 * follow-up hardening pass (audit 2026-04-17 L19).
 */

/**
 * Default character budget for the notebook section injected into the
 * Coach Pro system prompt. Roughly ~800 tokens, leaving headroom for the
 * message history and base system prompt.
 */
export const DEFAULT_NOTEBOOK_MAX_CHARS = 3200;

/**
 * A minimal shape required from a notebook entry for budget truncation.
 * The full DB row carries more columns but we only need these here.
 *
 * `updatedAt` is optional — when provided, a human-readable recency label
 * is injected into the formatted line so the model can surface newer entries
 * more prominently in its reasoning.
 */
export interface NotebookBudgetEntry {
  type: string;
  content: string;
  updatedAt?: Date;
}

/**
 * Returns a human-readable recency label for a notebook entry based on how
 * recently it was updated relative to `now`.
 *
 * Exported for unit testing.
 */
export function getRecencyLabel(
  updatedAt: Date,
  now: Date = new Date(),
): string {
  const diffMs = now.getTime() - updatedAt.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  if (diffDays < 2) return "recent";
  if (diffDays < 8) return "this week";
  if (diffDays < 31) return "this month";
  return "older";
}

/**
 * Line delimiters that wrap each notebook entry's content when injected into
 * the system prompt. Using explicit tags makes it structurally clear to the
 * model that the enclosed text is untrusted data (not instructions) and gives
 * downstream safety code an anchor to parse against.
 */
export const NOTEBOOK_ENTRY_OPEN = "<notebook_entry>";
export const NOTEBOOK_ENTRY_CLOSE = "</notebook_entry>";

export function escapeNotebookDelimiters(content: string): string {
  return content
    .replaceAll(NOTEBOOK_ENTRY_OPEN, "&lt;notebook_entry&gt;")
    .replaceAll(NOTEBOOK_ENTRY_CLOSE, "&lt;/notebook_entry&gt;");
}

/**
 * Format a single notebook entry into the line that appears inside the
 * system prompt. The content must already be sanitized by the caller.
 *
 * When `updatedAt` is present, a recency label is appended in parentheses
 * so the model can weight newer entries more heavily in its reasoning.
 */
export function formatNotebookLine(entry: NotebookBudgetEntry): string {
  const recency = entry.updatedAt
    ? ` (${getRecencyLabel(entry.updatedAt)})`
    : "";
  return `[${entry.type}${recency}] ${NOTEBOOK_ENTRY_OPEN}${escapeNotebookDelimiters(entry.content)}${NOTEBOOK_ENTRY_CLOSE}`;
}

/**
 * Durable personalization types render (and therefore survive truncation)
 * first. Anything unlisted shares the lowest bucket.
 */
const TYPE_PRIORITY: Record<string, number> = {
  preference: 0,
  commitment: 1,
  goal: 2,
};
const DEFAULT_TYPE_PRIORITY = 3;

/**
 * Order entries so durable personalization (preference, commitment, goal)
 * precedes transient types, with newest-first inside each bucket and stable
 * order for ties. Storage returns entries newest-first, so without this a
 * burst of recent insights evicts a months-old "vegetarian" preference at
 * the truncation budget. Pure — returns a new array.
 */
export function sortNotebookEntriesByPriority<T extends NotebookBudgetEntry>(
  entries: T[],
): T[] {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const pa = TYPE_PRIORITY[a.entry.type] ?? DEFAULT_TYPE_PRIORITY;
      const pb = TYPE_PRIORITY[b.entry.type] ?? DEFAULT_TYPE_PRIORITY;
      if (pa !== pb) return pa - pb;
      const ta = a.entry.updatedAt?.getTime() ?? 0;
      const tb = b.entry.updatedAt?.getTime() ?? 0;
      if (ta !== tb) return tb - ta;
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

/**
 * Truncate a list of pre-formatted notebook lines so the total character
 * count (including newline separators between lines) does not exceed
 * `maxChars`. Entries are kept in their original order and the first entry
 * that would overflow is dropped (along with everything after).
 *
 * Returns the joined string (newline-separated) or an empty string if no
 * entry fits within the budget.
 */
export function truncateNotebookToBudget(
  entries: NotebookBudgetEntry[],
  maxChars: number = DEFAULT_NOTEBOOK_MAX_CHARS,
): string {
  if (entries.length === 0 || maxChars <= 0) return "";
  const lines: string[] = [];
  let charCount = 0;
  for (const entry of entries) {
    const line = formatNotebookLine(entry);
    // Account for the newline separator inserted between lines on join.
    const separator = lines.length === 0 ? 0 : 1;
    if (charCount + separator + line.length > maxChars) break;
    lines.push(line);
    charCount += separator + line.length;
  }
  return lines.join("\n");
}
