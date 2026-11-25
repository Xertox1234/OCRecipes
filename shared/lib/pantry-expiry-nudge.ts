/**
 * The words of the Coach's "use it before it goes" nudge: the push the phone
 * shows and the message that opens the conversation the push links to. Fixed
 * wording, no model: a scheduled job writes it with nobody asking.
 */

const MAX_NAME_CHARS = 40;
/** Past this many items the nudge names two and counts the rest. */
const MAX_NAMED = 3;

export interface PantryExpiryNudge {
  /** Push title. */
  title: string;
  /** Push body: the one sentence saying what expires. */
  body: string;
  /** The Coach's opening message in the conversation. */
  message: string;
}

/** One line, lower case, at most 40 characters. */
function tidyName(raw: string): string {
  const flat = raw.replace(/\s+/g, " ").trim().toLowerCase();
  return flat.length > MAX_NAME_CHARS
    ? `${flat.slice(0, MAX_NAME_CHARS - 1)}…`
    : flat;
}

/**
 * @param names the expiring items' names, soonest first
 * @returns null when no name is usable
 */
export function renderPantryExpiryNudge(
  names: readonly string[],
): PantryExpiryNudge | null {
  const items = [...new Set(names.map(tidyName))].filter(Boolean);
  if (items.length === 0) return null;

  let list: string;
  if (items.length === 1) list = items[0];
  else if (items.length === 2) list = `${items[0]} and ${items[1]}`;
  else if (items.length === MAX_NAMED) {
    list = `${items[0]}, ${items[1]} and ${items[2]}`;
  } else {
    list = `${items[0]}, ${items[1]} and ${items.length - 2} more items`;
  }
  const one = items.length === 1;
  const body = `Your ${list} ${one ? "expires" : "expire"} within a day.`;
  return {
    title: "Use it before it goes",
    body,
    message: `${body} Want an idea for using ${one ? "it" : "them"} up?`,
  };
}
