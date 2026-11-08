/**
 * Where Coach Pro may release a streaming reply: the end of the last finished
 * sentence. The generator checks everything up to that point with
 * `containsUnsafeCoachAdvice` before yielding it, so the user sees the reply a
 * sentence at a time and never sees text the check has not passed.
 *
 * That is only sound because no unsafe-advice pattern can match across a
 * release point: they join words with `\s`, never a token that matches
 * `.`, `!`, `?` or the closers below, so a match lies wholly on one side.
 * Guarded by "unsafe-advice patterns never span a sentence break" in
 * `server/lib/__tests__/ai-safety.test.ts`.
 *
 * - A bare line break is NOT a release point: `\s+` crosses newlines, so a
 *   list item could end partway through a match.
 * - Nothing is released from the first backtick fence on: the coach_blocks
 *   JSON is vetted whole when the round ends (and has no sentences).
 */

/** Terminal punctuation, then any closing quotes, brackets or markdown
 *  emphasis, then whitespace (looked ahead, not consumed). */
const SENTENCE_END = /[.!?]+["'”’)\]*_]*(?=\s)/g;

/** The fence opener, or a trailing run of backticks that may become one. */
const FENCE_START = /```|`{1,2}$/;

/**
 * Length of the prefix of `pending` that ends at a sentence break and lies
 * before any code fence — 0 when no finished sentence is available yet.
 */
export function releasableLength(pending: string): number {
  const fence = pending.search(FENCE_START);
  const limit = fence === -1 ? pending.length : fence;
  let end = 0;
  for (const match of pending.matchAll(SENTENCE_END)) {
    const after = match.index + match[0].length;
    if (after >= limit) break;
    end = after;
  }
  return end;
}
