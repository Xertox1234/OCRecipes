import { describe, it, expect } from "vitest";
import { containsUnsafeCoachAdvice } from "../ai-safety";

/**
 * A refusal only excuses a sentence when it governs the unsafe phrase: a
 * refusal verb leading straight into it, or a danger statement about it
 * afterwards. A reassuring or unrelated negation does not ("it is not
 * risky", "and avoid snacks", "you can't go wrong"). The cases are generated
 * from wording x unsafe thing x position, so the rule is covered and not
 * only the sentences someone thought of (review of 2582c6aa7).
 */
describe("coach output screen: what counts as declining", () => {
  // Verb phrases the screen flags when stated plainly.
  const UNSAFE = [
    "eat only 900 calories a day",
    "stick to 800 calories per day",
    "try a 72-hour fast",
    "do a water-only fast",
    "fast for 3 days",
    "take laxatives to lose weight",
  ];
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  const REASSURING: ((x: string) => string)[] = [
    (x) => `Don't worry, ${x}.`,
    (x) => `You can't go wrong if you ${x}.`,
    (x) => `It isn't hard, just ${x}.`,
    (x) => `There is no risk, so ${x}.`,
    (x) => `${cap(x)}, it is not risky for you.`,
    (x) => `${cap(x)}, it's not dangerous.`,
    (x) => `${cap(x)}, there is little risk.`,
    (x) => `${cap(x)}, and avoid snacks.`,
    (x) => `${cap(x)}, it is fine and safe.`,
    (x) => `${cap(x)}, you can't go wrong.`,
    (x) => `${cap(x)}, it isn't harmful.`,
    (x) => `${cap(x)}, and don't overthink it.`,
    (x) => `${cap(x)}, it never fails.`,
  ];
  const DECLINING: ((x: string) => string)[] = [
    (x) => `I can't recommend that you ${x}.`,
    (x) => `Please don't ${x}.`,
    (x) => `I won't help you ${x}.`,
    (x) => `You should never ${x}.`,
    (x) => `I'd avoid trying to ${x}.`,
    (x) => `To ${x} isn't safe.`,
    (x) => `To ${x} is dangerous.`,
    (x) => `If you ${x}, that can harm your health.`,
    (x) => `To ${x} is risky, and I can't support it.`,
  ];

  it.each(UNSAFE)("control: flags the plain statement: %s", (x) => {
    expect(containsUnsafeCoachAdvice(`${cap(x)}.`)).toBe(true);
  });

  it.each(UNSAFE.flatMap((x) => REASSURING.map((wrap) => [wrap(x)])))(
    "still blocks: %s",
    (sentence) => {
      expect(containsUnsafeCoachAdvice(sentence)).toBe(true);
    },
  );

  it.each(UNSAFE.flatMap((x) => DECLINING.map((wrap) => [wrap(x)])))(
    "passes: %s",
    (sentence) => {
      expect(containsUnsafeCoachAdvice(sentence)).toBe(false);
    },
  );
});

describe("coach output screen: cost on a long whitespace run", () => {
  // The sentence splitter once scanned a run of spaces with no line break
  // quadratically: 80,000 spaces took about 4 s (review of 2582c6aa7).
  it.each([
    ["spaces", " ".repeat(80_000)],
    ["tabs and spaces after a word", `word${"\t ".repeat(40_000)}`],
  ])("screens %s quickly", (_name, text) => {
    const start = performance.now();
    expect(containsUnsafeCoachAdvice(text)).toBe(false);
    expect(performance.now() - start).toBeLessThan(500);
  });
});
