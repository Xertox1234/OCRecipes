// server/services/__tests__/notebook-extraction.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { extractNotebookEntries, shouldUpdateStrategy } from "../notebook-extraction";
import { openai } from "../../lib/openai";

vi.mock("../../lib/openai", () => ({
  openai: {
    chat: { completions: { create: vi.fn() } },
  },
  MODEL_FAST: "gpt-4o-mini",
}));

vi.mock("../../storage", () => ({
  storage: {
    getNotebookEntryCount: vi.fn().mockResolvedValue(3),
  },
}));

vi.mock("../../lib/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockCreate = vi.mocked(openai.chat.completions.create);

describe("Notebook Extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("extracts entries from a conversation", async () => {
    mockCreate.mockResolvedValue({
      choices: [{
        message: {
          content: JSON.stringify({
            entries: [
              { type: "preference", content: "Prefers quick meals under 15 min", followUpDate: null },
              { type: "commitment", content: "Try meal prepping on Sunday", followUpDate: "2026-04-13" },
            ],
          }),
        },
      }],
    } as never);

    const messages = [
      { role: "user" as const, content: "I need quick meal ideas" },
      { role: "assistant" as const, content: "Try meal prepping on Sunday!" },
    ];

    const entries = await extractNotebookEntries(messages, "user-1", 1);
    expect(entries).toHaveLength(2);
    expect(entries[0].type).toBe("preference");
    expect(entries[1].type).toBe("commitment");
    expect(entries[1].followUpDate).toBe("2026-04-13");
  });

  it("returns empty array on parse failure", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: "not json" } }],
    } as never);

    const entries = await extractNotebookEntries(
      [{ role: "user", content: "hello" }], "user-1", 1,
    );
    expect(entries).toEqual([]);
  });

  it("shouldUpdateStrategy returns true every 5 conversations", () => {
    expect(shouldUpdateStrategy(0)).toBe(true);
    expect(shouldUpdateStrategy(1)).toBe(false);
    expect(shouldUpdateStrategy(4)).toBe(false);
    expect(shouldUpdateStrategy(5)).toBe(true);
    expect(shouldUpdateStrategy(10)).toBe(true);
  });
});
