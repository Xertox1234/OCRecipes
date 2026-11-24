import { describe, it, expect } from "vitest";
import { classifyIntent } from "../coach-intent-classifier";
import corpus from "./fixtures/coach-intent-safety-corpus.json";

/**
 * Two-sided corpus for the coach intent rules (audit 2026-11-24, M31-M34).
 * `safety_refusal` loads a refuse-and-refer prompt bundle, so a false
 * positive makes the coach refuse an ordinary food question, and a false
 * negative skips the refusal guidance. `vague_request` tells the model to ask
 * a clarifying question and never guess, which is wrong for "Yes please".
 *
 * In the fixture a `why` that starts "VAGUE:" (mustBlock) is a vague opener,
 * and one that starts "SHORT:" (mustPass) is a short answer or command.
 */

/** mustBlock phrases the rules do not cover yet; the model's own safety
 *  instructions are the only guard for these. */
const KNOWN_GAPS = new Set([
  // A number written in words.
  "I plan to eat nine hundred calories a day.",
  // Mineral megadoses in mg need a per-nutrient upper limit table.
  "Can I take 500 mg of zinc every day for immunity?",
]);

const isVague = (c: { why: string }) => c.why.startsWith("VAGUE:");
const isShort = (c: { why: string }) => c.why.startsWith("SHORT:");

describe("coach intent corpus", () => {
  const safety = corpus.mustBlock.filter((c) => !isVague(c));
  const vague = corpus.mustBlock.filter(isVague);
  const ordinary = corpus.mustPass.filter((c) => !isShort(c));
  const short = corpus.mustPass.filter(isShort);

  it("has every group", () => {
    expect(safety.length).toBeGreaterThan(40);
    expect(vague.length).toBeGreaterThan(5);
    expect(ordinary.length).toBeGreaterThan(50);
    expect(short.length).toBeGreaterThan(10);
  });

  it.each(safety.filter((c) => !KNOWN_GAPS.has(c.text)).map((c) => [c.text]))(
    "safety_refusal: %s",
    (text) => {
      expect(classifyIntent(text).intent).toBe("safety_refusal");
    },
  );

  it.each([...KNOWN_GAPS].map((t) => [t]))(
    "known gap, not yet refused: %s",
    (text) => {
      // Pinned so that closing a gap means deleting it from KNOWN_GAPS.
      expect(classifyIntent(text).intent).not.toBe("safety_refusal");
    },
  );

  it.each(ordinary.map((c) => [c.text]))("not a refusal: %s", (text) => {
    expect(classifyIntent(text).intent).not.toBe("safety_refusal");
  });

  // recipeRequests off: with the finder on, "meal ideas" is a recipe request
  // before it is a vague one.
  it.each(vague.map((c) => [c.text]))("vague_request: %s", (text) => {
    expect(classifyIntent(text, { recipeRequests: false }).intent).toBe(
      "vague_request",
    );
  });

  it.each(short.map((c) => [c.text]))(
    "a short answer or command is not vague: %s",
    (text) => {
      const { intent } = classifyIntent(text);
      expect(intent).not.toBe("vague_request");
      expect(intent).not.toBe("safety_refusal");
    },
  );
});
