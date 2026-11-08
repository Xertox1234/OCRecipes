import { describe, it, expect } from "vitest";
import { releasableLength } from "../coach-sentence-release";

describe("releasableLength", () => {
  it("releases up to the end of the last finished sentence", () => {
    const text = "Oats are great. They have fiber. And the";
    expect(text.slice(0, releasableLength(text))).toBe(
      "Oats are great. They have fiber.",
    );
  });

  it("holds a sentence until whitespace follows its punctuation", () => {
    // The stream may still be inside "great.5" or "great!!" — wait.
    expect(releasableLength("Oats are great.")).toBe(0);
    expect(releasableLength("Oats are great!")).toBe(0);
  });

  it("splits on ! and ? as well as .", () => {
    const text = "Nice choice! Hungry later? Try this";
    expect(text.slice(0, releasableLength(text))).toBe(
      "Nice choice! Hungry later?",
    );
  });

  it("keeps closing quotes, brackets and markdown with their sentence", () => {
    const text = 'Aim for **146g.** Then "eat well." (Really.) Next';
    expect(text.slice(0, releasableLength(text))).toBe(
      'Aim for **146g.** Then "eat well." (Really.)',
    );
  });

  it("does not split inside a decimal number", () => {
    expect(releasableLength("Have 2.5 cups of")).toBe(0);
  });

  // A bare line break is not a boundary: the safety patterns' \s+ crosses
  // newlines, so a list item could end mid-match.
  it("does not split on a line break alone", () => {
    expect(releasableLength("- Eat oats\n- Drink water\n- Rest")).toBe(0);
  });

  it("splits at a sentence that ends a line", () => {
    const text = "Eat oats.\nDrink water";
    expect(text.slice(0, releasableLength(text))).toBe("Eat oats.");
  });

  // The coach_blocks fence holds back everything from where it opens: the
  // JSON is vetted whole at the end of the round.
  it("never releases into a code fence", () => {
    const text =
      'Sure thing. More here.\n\n```coach_blocks\n[{"type":"x","t":"A. B. C"}]';
    expect(text.slice(0, releasableLength(text))).toBe(
      "Sure thing. More here.",
    );
  });

  it("holds a fence that is still arriving", () => {
    const text = "Sure thing. Here.\n\n``";
    expect(text.slice(0, releasableLength(text))).toBe("Sure thing. Here.");
  });

  it("is zero with nothing to release", () => {
    expect(releasableLength("")).toBe(0);
    expect(releasableLength("No punctuation yet")).toBe(0);
  });
});
