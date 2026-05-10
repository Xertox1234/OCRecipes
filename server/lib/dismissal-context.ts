import { sanitizeUserInput } from "./ai-safety";

/**
 * Build a prompt fragment that instructs the AI to avoid re-suggesting
 * recipes the user has previously dismissed.
 *
 * Titles are sanitized via sanitizeUserInput() before inclusion because
 * community recipe titles are user-authored and can contain prompt injection
 * attempts. Sanitization must happen here, not at the call site.
 *
 * @param titles - Display titles of recently dismissed recipes (ordered, limit 25)
 * @returns A prompt fragment string, or "" if no titles survive sanitization
 */
export function buildDismissalContext(titles: string[]): string {
  if (titles.length === 0) return "";
  const safe = titles.map(sanitizeUserInput).filter((t) => t.length > 0);
  if (safe.length === 0) return "";
  return `AVOID SUGGESTING: The user has previously dismissed: ${safe.join(", ")}.`;
}
