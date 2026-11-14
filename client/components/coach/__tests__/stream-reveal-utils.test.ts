import { describe, it, expect } from "vitest";

import {
  initialRevealState,
  nextReveal,
  revealRate,
  type RevealPacing,
  type RevealState,
} from "../stream-reveal-utils";

const PACING: RevealPacing = {
  baseCharsPerSec: 60,
  catchUpMs: 1500,
  tailFlushMs: 120,
};
const TICK = 50;

/** Run `ticks` drain ticks over a fixed buffer, returning every release. */
function drain(
  text: string,
  ticks: number,
  done: boolean,
  pacing: RevealPacing = PACING,
): { releases: string[]; rest: string; state: RevealState } {
  let rest = text;
  let state = initialRevealState();
  const releases: string[] = [];
  for (let i = 0; i < ticks; i++) {
    const step = nextReveal(rest, TICK, done, state, pacing);
    state = step.state;
    if (step.release) {
      releases.push(step.release);
      rest = rest.slice(step.release.length);
    }
  }
  return { releases, rest, state };
}

describe("revealRate", () => {
  it("uses the base rate while the backlog is small", () => {
    expect(revealRate(10, PACING)).toBe(60);
  });

  it("speeds up in proportion to a large backlog", () => {
    // 3000 chars over a 1.5 s time constant → 2000 chars/s.
    expect(revealRate(3000, PACING)).toBe(2000);
  });
});

describe("nextReveal", () => {
  it("releases whole words — never a cut inside a word that has ended", () => {
    const text = "The quick brown fox jumps over the lazy dog and keeps going ";
    const { releases } = drain(text, 40, false);
    expect(releases.length).toBeGreaterThan(1);
    for (const r of releases) {
      // Each release ends a word: the next unreleased char is whitespace
      // (or nothing is left).
      const end = releases.slice(0, releases.indexOf(r) + 1).join("").length;
      const next = text.charAt(end);
      expect(next === "" || /\s/.test(next)).toBe(true);
    }
  });

  it("averages close to the base rate when the backlog is small", () => {
    // 600 chars of short words; 1 s of ticks at 60 chars/s base. The
    // backlog term (600 / 1.5 s = 400/s) would dominate, so use a long
    // time constant to isolate the base rate.
    const text = "ab cd ".repeat(100);
    const slow: RevealPacing = { ...PACING, catchUpMs: 60_000 };
    const { releases } = drain(text, 1000 / TICK, false, slow);
    const released = releases.join("").length;
    expect(released).toBeGreaterThanOrEqual(55);
    expect(released).toBeLessThanOrEqual(66);
  });

  it("catches up fast when a large backlog arrives at once", () => {
    const text = "word ".repeat(600); // 3000 chars
    const { releases } = drain(text, 1000 / TICK, false);
    // Far beyond 1 s at the base rate (60 chars).
    expect(releases.join("").length).toBeGreaterThan(1000);
  });

  it("holds an unfinished last word until the tail-flush wait passes", () => {
    let state = initialRevealState();
    // "Hel" may be the first half of a token-split word.
    let step = nextReveal("Hel", TICK, false, state, PACING);
    expect(step.release).toBe("");
    state = step.state;
    step = nextReveal("Hel", TICK, false, state, PACING);
    expect(step.release).toBe("");
    state = step.state;
    // 150 ms ≥ 120 ms tail wait — a stalled stream still shows the word.
    step = nextReveal("Hel", TICK, false, state, PACING);
    expect(step.release).toBe("Hel");
  });

  it("releases the unfinished last word at once when the stream is done", () => {
    const step = nextReveal("Hello", TICK, true, initialRevealState(), PACING);
    expect(step.release).toBe("Hello");
  });

  it("releases finished words ahead of a held tail", () => {
    // One 50 ms tick (3 chars of credit): "Hi" leaves credit, so " there"
    // goes too (as debt); "frie" has no whitespace after it yet — held.
    const step = nextReveal(
      "Hi there frie",
      TICK,
      false,
      initialRevealState(),
      PACING,
    );
    expect(step.release).toBe("Hi there");
  });

  it("does not bank credit while the buffer is empty", () => {
    let state = initialRevealState();
    for (let i = 0; i < 40; i++) {
      state = nextReveal("", TICK, false, state, PACING).state;
    }
    // 2 s idle must not turn into a burst: one tick's worth (3 chars at
    // 60/s) plus at most one whole word.
    const step = nextReveal(
      "alpha beta gamma delta epsilon ",
      TICK,
      false,
      state,
      PACING,
    );
    expect(step.release).toBe("alpha");
  });

  it("carries word overshoot as debt so long words don't speed it up", () => {
    // Each 20-char word costs ~7 ticks of base-rate credit.
    const text = `${"x".repeat(20)} `.repeat(10);
    const slow: RevealPacing = { ...PACING, catchUpMs: 60_000 };
    const { releases } = drain(text, 1000 / TICK, false, slow);
    const released = releases.join("").length;
    // ~60 chars/s → 3 words (63 chars incl. spaces), never all 10.
    expect(released).toBeLessThanOrEqual(84);
  });
});
