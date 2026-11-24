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
