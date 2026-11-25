/**
 * Turns the raw text a Coach model wrote into the text a user may see
 * (coach chat audit 2026-11-24, bundle A). Two things in a raw reply are not
 * prose:
 *
 * - the `coach_blocks` fence, whose JSON array becomes cards. Models close it
 *   wrongly (``` ``> ``` was seen live) or get cut off inside it, so the array
 *   is read by counting brackets, not by finding a perfect closing fence;
 * - the model's own citation markup, wrapped in private-use characters
 *   (U+E200 … U+E201), which draws as boxes and stray words.
 */

const FENCE_OPEN = "```coach_blocks";

/**
 * Index just past the JSON array that starts at `start` (which must be `[`),
 * or -1 when the text ends before the array closes. String-aware: brackets
 * and quotes inside JSON strings do not count. One pass, no backtracking.
 */
function arrayEnd(content: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < content.length; i++) {
    const ch = content[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/** Whitespace, then what a model writes to close a fence: 1-3 backticks, maybe `>`. */
const CLOSER = /^[ \t\r\n]*`{1,3}>?/;

export interface ExtractedFences {
  /** The reply without its fences. Not trimmed. */
  text: string;
  /** The raw JSON array of each fence, in order. Not parsed. */
  arrays: string[];
  /** True when a fence was cut off before its array closed. */
  truncated: boolean;
}

/**
 * The one fence scanner. `streaming` is for a reply still being written: it
 * also holds back a tail that may yet turn out to be fence syntax (the start
 * of an opener, or the whitespace before a closer), so the text it returns
 * only ever grows as the reply grows.
 */
function scanFences(content: string, streaming: boolean): ExtractedFences {
  const arrays: string[] = [];
  let text = "";
  let truncated = false;
  let pos = 0;
  while (pos < content.length) {
    const open = content.indexOf(FENCE_OPEN, pos);
    if (open === -1) {
      let tail = content.slice(pos);
      if (streaming) {
        const max = Math.min(FENCE_OPEN.length - 1, tail.length);
        for (let n = max; n > 0; n--) {
          if (FENCE_OPEN.startsWith(tail.slice(tail.length - n))) {
            tail = tail.slice(0, tail.length - n);
            break;
          }
        }
      }
      text += tail;
      break;
    }
    text += content.slice(pos, open);
    let start = open + FENCE_OPEN.length;
    while (start < content.length && /\s/.test(content[start])) start++;
    const end = content[start] === "[" ? arrayEnd(content, start) : -1;
    if (end === -1) {
      truncated = true;
      break;
    }
    arrays.push(content.slice(start, end));
    const closer = CLOSER.exec(content.slice(end, end + 16));
    // Only whitespace so far after the array: the closer may still be coming.
    if (streaming && !closer && /^[ \t\r\n]*$/.test(content.slice(end))) break;
    pos = end + (closer ? closer[0].length : 0);
  }
  return { text, arrays, truncated };
}

/**
 * Splits a reply into prose and the JSON arrays of its `coach_blocks` fences.
 * A fence whose array never closes is dropped from its opener to the end of
 * the reply: it is half-written JSON, never prose.
 */
export function extractBlockFences(content: string): ExtractedFences {
  return scanFences(content, false);
}

/** The longest body a citation span is expected to have. */
const CITATION_MAX = 200;
/** A whole citation span: opener, a short body, closer. */
const CITATION_SPAN = new RegExp(
  `\\uE200[^\\uE200\\uE201]{0,${CITATION_MAX}}\\uE201`,
  "g",
);
/** The markup characters on their own (a span the model never closed). */
const CITATION_CHARS = /[\uE200-\uE2FF]/g;

/**
 * What takes a removed marker's place: a space when it sat between two
 * characters, nothing otherwise. The safety screen reads the raw reply, where
 * the marker splits "5" from "00"; joining them would show text it never saw.
 */
function gap(match: string, offset: number, whole: string): string {
  const left = whole[offset - 1];
  const right = whole[offset + match.length];
  return left && right && !/\s/.test(left) && !/\s/.test(right) ? " " : "";
}

/**
 * Removes the model's own citation markup. A closed span goes whole; an
 * unclosed opener (or a span longer than expected) loses only its marker
 * characters, so it cannot swallow the rest of the reply.
 */
export function stripCitationMarkers(text: string): string {
  return text.replace(CITATION_SPAN, gap).replace(CITATION_CHARS, gap);
}

/**
 * The part of a reply-in-progress that is safe to show now. It only ever
 * grows as `raw` grows, so the caller can send `visible.slice(alreadySent)`,
 * and for a finished reply it equals the saved text before trimming.
 *
 * Held back: a fence until its array has closed (cards arrive in their own
 * event), a tail that may yet be fence syntax, and a citation span that has
 * just opened (until it closes or runs past the expected length).
 */
export function streamVisibleText(raw: string): string {
  const text = scanFences(raw, true).text.replace(CITATION_SPAN, gap);
  const opener = text.indexOf("\uE200");
  const justOpened =
    opener !== -1 &&
    text.indexOf("\uE201", opener) === -1 &&
    text.length - opener - 1 <= CITATION_MAX;
  return (justOpened ? text.slice(0, opener) : text).replace(
    CITATION_CHARS,
    gap,
  );
}
