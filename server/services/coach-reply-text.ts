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
 * Splits a reply into prose and the JSON arrays of its `coach_blocks` fences.
 * A fence whose array never closes is dropped from its opener to the end of
 * the reply: it is half-written JSON, never prose.
 */
export function extractBlockFences(content: string): ExtractedFences {
  const arrays: string[] = [];
  let text = "";
  let truncated = false;
  let pos = 0;
  while (pos < content.length) {
    const open = content.indexOf(FENCE_OPEN, pos);
    if (open === -1) {
      text += content.slice(pos);
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
    pos = end + (closer ? closer[0].length : 0);
  }
  return { text, arrays, truncated };
}

/** A whole citation span: opener, a short body, closer. */
const CITATION_SPAN = /[^]{0,200}/g;
/** The markup characters on their own (a span the model never closed). */
const CITATION_CHARS = /[-]/g;

/**
 * Removes the model's own citation markup. A closed span goes whole; an
 * unclosed opener loses only its marker characters, so it cannot swallow the
 * rest of the reply.
 */
export function stripCitationMarkers(text: string): string {
  return text.replace(CITATION_SPAN, "").replace(CITATION_CHARS, "");
}

/**
 * The part of a reply-in-progress that is safe to show now. It only ever
 * grows as `raw` grows, so the caller can send `visible.slice(alreadySent)`.
 *
 * Held back: everything from a fence opener on (cards arrive in their own
 * event), a trailing run that could be the start of an opener, and
 * everything from a citation span that has not closed yet.
 */
export function streamVisibleText(raw: string): string {
  let text = raw;
  const open = text.indexOf(FENCE_OPEN);
  if (open !== -1) {
    text = text.slice(0, open);
  } else {
    const max = Math.min(FENCE_OPEN.length - 1, text.length);
    for (let n = max; n > 0; n--) {
      if (FENCE_OPEN.startsWith(text.slice(text.length - n))) {
        text = text.slice(0, text.length - n);
        break;
      }
    }
  }
  text = text.replace(CITATION_SPAN, "");
  const unclosed = text.indexOf("");
  if (unclosed !== -1) text = text.slice(0, unclosed);
  return text.replace(CITATION_CHARS, "");
}
