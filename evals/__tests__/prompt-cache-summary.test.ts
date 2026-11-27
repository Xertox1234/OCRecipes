import { describe, expect, it } from "vitest";
import type { AiCallRecord } from "../../server/lib/ai-call-context";
import {
  formatPromptCacheSummary,
  summarizePromptCache,
} from "../lib/prompt-cache-summary";

function call(
  feature: AiCallRecord["feature"],
  provider: string | null,
  prompt: number,
  cached?: number,
): AiCallRecord {
  return {
    feature,
    requestedModel: "m",
    answeredModel: "m",
    answeredProvider: provider,
    fellBack: false,
    usage: {
      prompt_tokens: prompt,
      ...(cached !== undefined && {
        prompt_tokens_details: { cached_tokens: cached },
      }),
    },
  };
}

describe("summarizePromptCache (audit LV4)", () => {
  it("counts only the first call of each feature in a sample", () => {
    const rows = summarizePromptCache([
      {
        aiCalls: [
          call("coach-pro-chat", "Azure", 6000, 0),
          // a later tool-loop call reuses the prefix; it must not count
          call("coach-pro-chat", "Azure", 6500, 6000),
        ],
      },
      { aiCalls: [call("coach-pro-chat", "Azure", 6000, 5800)] },
    ]);
    expect(rows).toEqual([
      {
        feature: "coach-pro-chat",
        provider: "Azure",
        samples: 2,
        hits: 1,
        promptTokens: 12000,
        cachedTokens: 5800,
      },
    ]);
  });

  it("selects by feature, not by call index", () => {
    const rows = summarizePromptCache([
      {
        aiCalls: [
          call("coach-notebook-extract", "Google", 800, 0),
          call("coach-pro-chat", "Azure", 6000, 6000),
        ],
      },
    ]);
    expect(rows.map((r) => [r.feature, r.hits])).toEqual([
      ["coach-notebook-extract", 0],
      ["coach-pro-chat", 1],
    ]);
  });

  it("keeps providers apart, since each one has its own cache", () => {
    const rows = summarizePromptCache([
      { aiCalls: [call("coach-pro-chat", "Azure", 6000, 6000)] },
      { aiCalls: [call("coach-pro-chat", "OpenAI", 6000, 0)] },
    ]);
    expect(rows.map((r) => [r.provider, r.hits])).toEqual([
      ["Azure", 1],
      ["OpenAI", 0],
    ]);
  });

  it("treats missing cache details as zero and skips failed calls", () => {
    const failed: AiCallRecord = {
      ...call("coach-pro-chat", null, 0),
      usage: undefined,
      error: { kind: "transport", moderated: false, message: "x" },
    };
    const rows = summarizePromptCache([
      { aiCalls: [failed, call("coach-pro-chat", "Azure", 6000)] },
      {},
    ]);
    expect(rows).toEqual([
      {
        feature: "coach-pro-chat",
        provider: "Azure",
        samples: 1,
        hits: 0,
        promptTokens: 6000,
        cachedTokens: 0,
      },
    ]);
  });

  it("formats one line per feature and provider", () => {
    expect(
      formatPromptCacheSummary([
        {
          feature: "coach-pro-chat",
          provider: "Azure",
          samples: 4,
          hits: 1,
          promptTokens: 24000,
          cachedTokens: 6000,
        },
      ]),
    ).toEqual([
      "Prompt cache, first call per sample:",
      "  coach-pro-chat via Azure: 1/4 samples hit, 6000/24000 prompt tokens cached (25%)",
    ]);
    expect(formatPromptCacheSummary([])).toEqual([]);
  });
});
