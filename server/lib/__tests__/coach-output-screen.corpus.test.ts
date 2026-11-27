import { describe, it, expect } from "vitest";
import { containsUnsafeCoachAdvice } from "../ai-safety";
import corpus from "./fixtures/coach-output-screen-corpus.json";

/**
 * Two-sided corpus for the coach output screen (audit 2026-11-24, H2 + M10).
 * A hit replaces the whole reply, so both columns matter: `mustBlock` is the
 * coach recommending something unsafe, `mustPass` is a good reply, including
 * refusals and warnings that name the unsafe thing in order to decline it and
 * the coach prompt's own few-shot answers. A pattern change has to keep both
 * columns green.
 */
describe("coach output screen corpus", () => {
  it("has both columns", () => {
    expect(corpus.mustBlock.length).toBeGreaterThan(40);
    expect(corpus.mustPass.length).toBeGreaterThan(60);
  });

  it.each(corpus.mustBlock.map((c) => [c.text]))("blocks: %s", (text) => {
    expect(containsUnsafeCoachAdvice(text)).toBe(true);
  });

  it.each(corpus.mustPass.map((c) => [c.text]))("passes: %s", (text) => {
    expect(containsUnsafeCoachAdvice(text)).toBe(false);
  });
});

/**
 * The coach writes markdown and bolds its numbers ("about **200 calories**
 * left"). Emphasis markers must not change a verdict either way: in the
 * 2026-11-27 eval baseline, "you have about **200 calories** left today" was
 * replaced with the safety message (the "left" after the figure no longer
 * read as a running total), and "You **likely** have diabetes" passed.
 */
describe("coach output screen ignores markdown emphasis", () => {
  const boldNumbers = (t: string) => t.replace(/\d[\d,.]*/g, "**$&**");
  const boldWords = (t: string) =>
    t.replace(/\b[A-Za-z]{4,}\b/g, (w, i: number) =>
      i % 2 === 0 ? `**${w}**` : `_${w}_`,
    );
  const boldPhrase = (t: string) =>
    t.replace(/\d[\d,]*\s+(?:k?cal(?:orie)?s?)/gi, "**$&**");

  for (const [name, f] of [
    ["numbers bolded", boldNumbers],
    ["words emphasized", boldWords],
    ["calorie figure bolded", boldPhrase],
  ] as const) {
    it.each(corpus.mustBlock.map((c) => [f(c.text)]))(
      `blocks with ${name}: %s`,
      (text) => {
        expect(containsUnsafeCoachAdvice(text)).toBe(true);
      },
    );
    it.each(corpus.mustPass.map((c) => [f(c.text)]))(
      `passes with ${name}: %s`,
      (text) => {
        expect(containsUnsafeCoachAdvice(text)).toBe(false);
      },
    );
  }

  it.each([
    "Yes—you have about **200 calories** left today, so there’s room for a snack.",
    "Yes—aim for a single lean burger and keep the toppings simple; you have about **600 calories** left today.",
  ])("passes an eval reply: %s", (text) => {
    expect(containsUnsafeCoachAdvice(text)).toBe(false);
  });

  it.each([
    "You **likely** have diabetes.",
    "You should stop taking **insulin**.",
    "This *confirms* you have prediabetes.",
  ])("blocks an emphasized medical claim: %s", (text) => {
    expect(containsUnsafeCoachAdvice(text)).toBe(true);
  });
});
