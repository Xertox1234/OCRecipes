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
  /**
   * Push body: how many items expire, never which. It shows on the lock
   * screen, and an item's name is whatever the user typed.
   */
  body: string;
  /** The Coach's opening message in the conversation. */
  message: string;
}

/** Control characters, zero-width characters and text-direction marks. */
const INVISIBLE =
  /[\u0000-\u0008\u000B-\u001F\u007F\u00AD\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF]/g;

/**
 * One line, lower case, nothing invisible, at most 40 characters (counted so
 * an emoji is never cut in half).
 */
function tidyName(raw: string): string {
  const flat = raw
    .replace(INVISIBLE, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  const chars = Array.from(flat);
  return chars.length > MAX_NAME_CHARS
    ? `${chars.slice(0, MAX_NAME_CHARS - 1).join("")}…`
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
  const verb = one ? "expires" : "expire";
  return {
    title: "Use it before it goes",
    body: `${items.length} ${one ? "item" : "items"} in your pantry ${verb} within a day.`,
    message: `Your ${list} ${verb} within a day. Want an idea for using ${one ? "it" : "them"} up?`,
  };
}
