import { describe, it, expect, vi, beforeEach } from "vitest";
import { askClarifying, FALLBACK_QUESTIONS } from "../ask-clarifying";
import { aiChat } from "../../../lib/ai-client";
import { createMockChatCompletion } from "../../../__tests__/factories";

vi.mock("../../../lib/ai-client", () => ({ aiChat: vi.fn() }));
vi.mock("../../../lib/openai", () => ({
  OPENAI_TIMEOUT_FAST_MS: 15_000,
}));
vi.mock("../../../lib/ai-safety", () => ({
  sanitizeUserInput: vi.fn((t: string) => t),
  sanitizeContextField: vi.fn((t: string) => t),
  validateAiResponse: vi.fn(
    (
      data: unknown,
      schema: {
        safeParse: (d: unknown) => { success: boolean; data?: unknown };
      },
    ) => {
      const r = schema.safeParse(data);
      return r.success ? r.data : null;
    },
  ),
  SYSTEM_PROMPT_BOUNDARY: "---BOUNDARY---",
}));

const mockCreate = vi.mocked(aiChat);

beforeEach(() => vi.clearAllMocks());

describe("askClarifying", () => {
  it("returns the AI's 2–3 questions", async () => {
    const questions = [
      {
        question: "How much time do you have?",
        options: ["15 min", "30 min", "1 hour"],
      },
      { question: "Which protein?", options: ["Chicken", "Tofu"] },
    ];
    mockCreate.mockResolvedValue(
      createMockChatCompletion(JSON.stringify({ questions })),
    );
    await expect(askClarifying("Mediterranean", [])).resolves.toEqual(
      questions,
    );
    expect(mockCreate.mock.calls[0][0]).toBe("finder-ask-clarifying");
  });

  it("falls back to fixed time/cuisine/diet questions when the AI throws", async () => {
    mockCreate.mockRejectedValue(new Error("timeout"));
    const out = await askClarifying("Mediterranean", []);
    expect(out).toEqual(FALLBACK_QUESTIONS);
    expect(out.map((q) => q.question)).toEqual([
      "How much time do you have?",
      "Any cuisine you're in the mood for?",
      "Any diet to follow?",
    ]);
  });

  it("falls back when the AI returns only one question", async () => {
    mockCreate.mockResolvedValue(
      createMockChatCompletion(
        JSON.stringify({
          questions: [{ question: "Q?", options: ["a", "b"] }],
        }),
      ),
    );
    await expect(askClarifying("x", [])).resolves.toEqual(FALLBACK_QUESTIONS);
  });

  it("falls back on invalid JSON", async () => {
    mockCreate.mockResolvedValue(createMockChatCompletion("nope"));
    await expect(askClarifying("x", [])).resolves.toEqual(FALLBACK_QUESTIONS);
  });
});
