import { describe, it, expect, vi, beforeEach } from "vitest";
import { judgeGeneric } from "../lib/judge-generic";

// vi.mock is hoisted above const declarations; vi.hoisted() defines the spy
// before the mock factory runs.
const anthropicMock = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: anthropicMock.create };
  },
}));

describe("judgeGeneric on the Anthropic backend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("EVAL_JUDGE_BACKEND", "anthropic");
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    vi.stubEnv("EVAL_JUDGE_MODEL", "");
    anthropicMock.create.mockResolvedValue({
      content: [
        {
          type: "text",
          text: JSON.stringify({
            scores: [{ dimension: "accuracy", score: 8, reasoning: "ok" }],
          }),
        },
      ],
    });
  });

  it("sends no sampling parameters — API version 2026-10-21 rejects them with a 400", async () => {
    const result = await judgeGeneric({
      inputSummary: "What should I eat?",
      outputText: "A balanced meal.",
      dimensions: ["accuracy"],
      rubricText: "Score accuracy from 1 to 10.",
    });

    expect(anthropicMock.create).toHaveBeenCalledTimes(1);
    const params = anthropicMock.create.mock.calls[0][0];
    expect(params).not.toHaveProperty("temperature");
    expect(params).not.toHaveProperty("top_p");
    expect(params).not.toHaveProperty("top_k");
    // The rest of the request is unchanged.
    expect(params.model).toBe("claude-sonnet-4-6");
    expect(params.max_tokens).toBe(1000);
    expect(params.system).toBe("Score accuracy from 1 to 10.");
    expect(params.messages).toHaveLength(1);
    expect(params.messages[0].role).toBe("user");

    expect(result.scores).toEqual([
      { dimension: "accuracy", score: 8, reasoning: "ok" },
    ]);
    expect(result.judgeModel).toBe("claude-sonnet-4-6");
  });
});
