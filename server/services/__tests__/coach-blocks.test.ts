// server/services/__tests__/coach-blocks.test.ts
import { describe, it, expect } from "vitest";
import { validateBlocks, parseBlocksFromContent } from "../coach-blocks";

describe("Coach Blocks Service", () => {
  it("validates valid blocks array", () => {
    const blocks = [
      {
        type: "quick_replies",
        options: [{ label: "Yes", message: "Yes please" }],
      },
    ];
    const result = validateBlocks(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("quick_replies");
  });

  it("filters out invalid blocks silently", () => {
    const blocks = [
      { type: "unknown_type", data: "bad" },
      {
        type: "quick_replies",
        options: [{ label: "Yes", message: "Yes please" }],
      },
    ];
    const result = validateBlocks(blocks);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("quick_replies");
  });

  it("returns empty array for no valid blocks", () => {
    const result = validateBlocks([{ type: "bad" }]);
    expect(result).toEqual([]);
  });

  it("parses blocks from JSON-annotated content", () => {
    const content =
      'Here are some options:\n```coach_blocks\n[{"type":"quick_replies","options":[{"label":"Yes","message":"Yes"}]}]\n```';
    const { text, blocks } = parseBlocksFromContent(content);
    expect(text).toBe("Here are some options:");
    expect(blocks).toHaveLength(1);
  });

  it("returns original content when no blocks marker found", () => {
    const content = "Just plain text response";
    const { text, blocks } = parseBlocksFromContent(content);
    expect(text).toBe("Just plain text response");
    expect(blocks).toEqual([]);
  });

  it("parses both fences when content contains two coach_blocks fences", () => {
    const content = `Here is chart one.\n\`\`\`coach_blocks\n[{"type":"quick_replies","options":[{"label":"Yes","message":"yes"}]}]\n\`\`\`\nAnd here is another.\n\`\`\`coach_blocks\n[{"type":"quick_replies","options":[{"label":"No","message":"no"}]}]\n\`\`\``;
    const result = parseBlocksFromContent(content);
    // Both fences stripped from text
    expect(result.text).not.toContain("```coach_blocks");
    // At least two blocks parsed
    expect(result.blocks.length).toBe(2);
  });
});
