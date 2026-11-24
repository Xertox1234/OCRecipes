import { describe, it, expect } from "vitest";
import { sanitizeUserInput } from "../ai-safety";
import corpus from "./fixtures/sanitize-user-input-corpus.json";

/**
 * Two-sided corpus for sanitizeUserInput (audit 2026-11-24, M49). A match is
 * rewritten to "[filtered]" before the model sees the message and before it
 * is saved, so a false positive silently corrupts an ordinary question
 * ("show me the instructions for the lasagna"). `mustBlock` are real
 * injection attempts; `mustPass` must come back unchanged.
 */
describe("sanitizeUserInput corpus", () => {
  it("has both columns", () => {
    expect(corpus.mustBlock.length).toBeGreaterThan(35);
    expect(corpus.mustPass.length).toBeGreaterThan(55);
  });

  it.each(corpus.mustBlock.map((c) => [c.text]))("filters: %s", (text) => {
    expect(sanitizeUserInput(text)).toContain("[filtered]");
  });

  it.each(corpus.mustPass.map((c) => [c.text]))("leaves alone: %s", (text) => {
    expect(sanitizeUserInput(text)).toBe(text.trim());
  });
});
