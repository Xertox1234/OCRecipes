import { describe, it, expect } from "vitest";
import {
  extractBlockFences,
  streamVisibleText,
  stripCitationMarkers,
} from "../coach-reply-text";

// Both fixtures are real saved replies from the 2026-11-24 coach chat audit
// (local messages 130378 and 130364).
const CHART_JSON =
  '[{"type":"inline_chart","chartType":"progress","title":"Protein today","data":[{"label":"Logged","value":0,"target":146}],"summary":"146g daily goal"},{"type":"quick_replies","options":[{"label":"Log breakfast","message":"Help me log my two scrambled eggs and whole-wheat toast"},{"label":"More snack ideas","message":"Suggest more quick plant-based high-protein snacks"}]}]';
const BAD_CLOSER_REPLY = `For an easy plant-based boost, try **edamame with lemon** this afternoon.\n\n\`\`\`coach_blocks\n${CHART_JSON}\n\`\`>\n`;
const CITE = "citememory_refs";
const CITE_REPLY = `plant-based yogurts vary. ${CITE}`;

describe("extractBlockFences", () => {
  it("reads the block array when the model closed the fence with ``>", () => {
    const { text, arrays, truncated } = extractBlockFences(BAD_CLOSER_REPLY);
    expect(text.trim()).toBe(
      "For an easy plant-based boost, try **edamame with lemon** this afternoon.",
    );
    expect(arrays).toEqual([CHART_JSON]);
    expect(truncated).toBe(false);
  });

  it("reads a well-formed fence and keeps the prose after it", () => {
    const { text, arrays } = extractBlockFences(
      'Before.\n```coach_blocks\n[{"a":1}]\n```\nAfter.',
    );
    expect(arrays).toEqual(['[{"a":1}]']);
    expect(text).toBe("Before.\n\nAfter.");
  });

  it("reads a fence with no closer at all", () => {
    const { text, arrays, truncated } = extractBlockFences(
      'Hi.\n```coach_blocks\n[{"a":1}]',
    );
    expect(arrays).toEqual(['[{"a":1}]']);
    expect(text.trim()).toBe("Hi.");
    expect(truncated).toBe(false);
  });

  it("is not fooled by brackets, quotes and backticks inside strings", () => {
    const json = '[{"t":"a ] b \\" c [ ``` d","n":[1,[2]]}]';
    const { arrays, text } = extractBlockFences(
      `X\n\`\`\`coach_blocks\n${json}\n\`\`\`\nY`,
    );
    expect(arrays).toEqual([json]);
    expect(text).toBe("X\n\nY");
  });

  it("reads two fences in one reply", () => {
    const { arrays, text } = extractBlockFences(
      'A\n```coach_blocks\n[{"a":1}]\n```\nB\n```coach_blocks\n[{"b":2}]\n```\nC',
    );
    expect(arrays).toEqual(['[{"a":1}]', '[{"b":2}]']);
    expect(text).toBe("A\n\nB\n\nC");
  });

  it("drops a fence cut off mid-array, with nothing after the opener kept", () => {
    const { text, arrays, truncated } = extractBlockFences(
      'Plan below.\n```coach_blocks\n[{"type":"meal_plan_card","title":"We',
    );
    expect(arrays).toEqual([]);
    expect(text.trim()).toBe("Plan below.");
    expect(truncated).toBe(true);
  });

  it("returns text with no fence unchanged, however long", () => {
    const long = "word ".repeat(5000);
    expect(extractBlockFences(long).text).toBe(long);
  });

  it("finds a fence that starts past 16,000 characters", () => {
    const { arrays, text } = extractBlockFences(
      `${"x".repeat(17_000)}\n\`\`\`coach_blocks\n[{"a":1}]\n\`\`\``,
    );
    expect(arrays).toEqual(['[{"a":1}]']);
    expect(text.trim()).toHaveLength(17_000);
  });
});

describe("stripCitationMarkers", () => {
  it("removes the model's own citation markup", () => {
    expect(stripCitationMarkers(CITE_REPLY)).toBe("plant-based yogurts vary. ");
  });

  it("removes an opener with no closer without eating the text after it", () => {
    expect(stripCitationMarkers("a cite and the rest stays")).toBe(
      "a cite and the rest stays",
    );
  });

  it("leaves ordinary text, emoji and accents alone", () => {
    const s = "Café 🥑 — 20 g protein [1]";
    expect(stripCitationMarkers(s)).toBe(s);
  });
});

describe("streamVisibleText", () => {
  /** What a client would have shown after each chunk boundary. */
  function shownAtEveryCut(raw: string): string[] {
    const out: string[] = [];
    for (let i = 0; i <= raw.length; i++) {
      out.push(streamVisibleText(raw.slice(0, i)));
    }
    return out;
  }

  it("never shows any part of the block fence, at any cut", () => {
    for (const shown of shownAtEveryCut(BAD_CLOSER_REPLY)) {
      expect(shown).not.toContain("`");
      expect(shown).not.toContain("coach_blocks");
      expect(shown).not.toContain("inline_chart");
    }
  });

  it("never shows any part of a citation marker, at any cut", () => {
    for (const shown of shownAtEveryCut(`${CITE_REPLY} More text.`)) {
      expect(shown).not.toMatch(/[-]/);
      expect(shown).not.toContain("memory_refs");
    }
    expect(streamVisibleText(`${CITE_REPLY} More text.`)).toBe(
      "plant-based yogurts vary.  More text.",
    );
  });

  it("only ever grows: each cut's text starts with the cut before it", () => {
    for (const raw of [
      BAD_CLOSER_REPLY,
      `${CITE_REPLY} More text.`,
      "Use `olive oil` here. Done.",
    ]) {
      const shown = shownAtEveryCut(raw);
      for (let i = 1; i < shown.length; i++) {
        expect(shown[i].startsWith(shown[i - 1])).toBe(true);
      }
    }
  });

  it("shows plain prose in full", () => {
    expect(streamVisibleText("Two eggs have about 12 g protein.")).toBe(
      "Two eggs have about 12 g protein.",
    );
  });
});
