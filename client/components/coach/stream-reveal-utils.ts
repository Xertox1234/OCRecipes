/**
 * Pacing for revealing a streamed Coach reply on screen.
 *
 * Network chunks arrive in bursts and split words mid-way. Instead of
 * painting them as they land (or slicing a fixed number of characters per
 * tick), the stream hook buffers the text and asks `nextReveal` each drain
 * tick how much to show. It releases whole words, at a rate that is calm
 * while the backlog is small and speeds up in proportion to a large one, so
 * the reply reads like someone talking rather than a block being pasted.
 *
 * Pure — no timers, no React — so the drain loop's behaviour is unit-tested
 * here. The tuning values live in `client/constants/animations.ts`
 * (`coachRevealPacing`).
 */

export interface RevealPacing {
  /** Reveal speed, in characters per second, while the backlog is small. */
  baseCharsPerSec: number;
  /** Time constant for working off a large backlog: the rate is at least
   *  `backlog / catchUpMs`, so a flood of text never trails far behind. */
  catchUpMs: number;
  /** How long a trailing word with no whitespace after it yet (possibly
   *  the first half of a token-split word) is held before it is shown
   *  anyway, so a stalled stream never hides text for long. */
  tailFlushMs: number;
}

export interface RevealState {
  /** Characters the reveal may still show. Goes negative after a long word
   *  so whole-word steps still average out to the target rate. */
  credit: number;
  /** How long the current unfinished trailing word has been held. */
  tailWaitMs: number;
}

export function initialRevealState(): RevealState {
  return { credit: 0, tailWaitMs: 0 };
}

/** Characters per second to reveal at, given how many are waiting. */
export function revealRate(backlog: number, pacing: RevealPacing): number {
  return Math.max(pacing.baseCharsPerSec, (backlog * 1000) / pacing.catchUpMs);
}

/** Leading whitespace plus the next word (or just whitespace at the end). */
const NEXT_WORD = /^\s*\S*/;

/**
 * One drain tick: how much of `buffer` to show now, and the state to pass
 * to the next tick.
 *
 * @param buffer  text received but not yet shown
 * @param dtMs    time since the previous tick
 * @param done    the server has finished sending — nothing more will arrive
 */
export function nextReveal(
  buffer: string,
  dtMs: number,
  done: boolean,
  state: RevealState,
  pacing: RevealPacing,
): { release: string; state: RevealState } {
  if (buffer.length === 0) {
    // Idle time must not bank credit — the next word would burst out.
    // Debt from a long word is kept.
    return {
      release: "",
      state: { credit: Math.min(state.credit, 0), tailWaitMs: 0 },
    };
  }

  const rate = revealRate(buffer.length, pacing);
  const tickCredit = (rate * dtMs) / 1000;
  // At most two ticks' worth of surplus, so time spent holding a tail
  // doesn't turn into a burst when it lets go.
  let credit = Math.min(state.credit + tickCredit, tickCredit * 2);

  let release = "";
  let rest = buffer;
  let holdingTail = false;
  while (credit > 0 && rest.length > 0) {
    const word = NEXT_WORD.exec(rest)?.[0] ?? rest;
    const finished = word.length < rest.length; // whitespace follows it
    if (!finished && !done && state.tailWaitMs + dtMs < pacing.tailFlushMs) {
      holdingTail = true;
      break;
    }
    release += word;
    rest = rest.slice(word.length);
    credit -= word.length;
  }

  return {
    release,
    state: {
      credit,
      tailWaitMs: holdingTail ? state.tailWaitMs + dtMs : 0,
    },
  };
}
