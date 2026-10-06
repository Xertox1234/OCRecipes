// server/lib/__tests__/ai-models.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  AI_FEATURES,
  adaptParams,
  hostForModel,
  isAiFeature,
  type AiFeatureConfig,
} from "../ai-models";

describe("AI_FEATURES table", () => {
  const rows: [string, AiFeatureConfig][] = Object.entries(AI_FEATURES);

  it("has one row per call site (30)", () => {
    expect(rows).toHaveLength(30);
  });

  it("every model has a provider/ prefix and no fallback does", () => {
    for (const [name, row] of rows) {
      expect(row.model, name).toMatch(/^[a-z0-9-]+\/[^/]+$/);
      expect(row.fallback, name).not.toContain("/");
    }
  });

  // Owner-approved switches (spec §6 step 5). Every other row still runs
  // today's model: its fallback with the openai/ prefix and no adapt.
  const SWITCHED: Record<string, AiFeatureConfig> = {
    "coach-chat": {
      model: "openai/gpt-6-luna",
      fallback: "gpt-4o-mini",
      json: false,
      vision: false,
      adapt: { drop: ["temperature"], set: { reasoning_effort: "low" } },
    },
    "coach-pro-chat": {
      model: "openai/gpt-6-luna",
      fallback: "gpt-4o-mini",
      json: false,
      vision: false,
      adapt: { drop: ["temperature"], set: { reasoning_effort: "low" } },
    },
  };

  it("switched rows are exactly the approved ones", () => {
    for (const [name, row] of Object.entries(SWITCHED)) {
      expect(AI_FEATURES[name as keyof typeof AI_FEATURES], name).toEqual(row);
    }
  });

  it("every other row is its fallback with the openai/ prefix and no adapt", () => {
    for (const [name, row] of rows) {
      if (name in SWITCHED) continue;
      expect(row.model, name).toBe(`openai/${row.fallback}`);
      expect(row.adapt, name).toBeUndefined();
    }
  });

  it("every row's model has a pinned OpenRouter host", () => {
    for (const [name, row] of rows) {
      expect(hostForModel(row.model), name).toBeDefined();
    }
  });

  it("isAiFeature narrows known names only", () => {
    expect(isAiFeature("coach-chat")).toBe(true);
    expect(isAiFeature("nope")).toBe(false);
    expect(isAiFeature("toString")).toBe(false);
  });
});

describe("adaptParams", () => {
  it("returns a copy unchanged when there is no adapt", () => {
    const params = { temperature: 0.5, max_completion_tokens: 10 };
    const out = adaptParams(params, undefined);
    expect(out).toEqual(params);
    expect(out).not.toBe(params);
  });

  it("drops keys", () => {
    expect(
      adaptParams({ temperature: 0.5, n: 1 }, { drop: ["temperature"] }),
    ).toEqual({ n: 1 });
  });

  it("renames keys, never overwriting an existing target", () => {
    expect(
      adaptParams(
        { max_completion_tokens: 10 },
        { rename: { max_completion_tokens: "max_tokens" } },
      ),
    ).toEqual({ max_tokens: 10 });
    expect(
      adaptParams(
        { max_completion_tokens: 10, max_tokens: 99 },
        { rename: { max_completion_tokens: "max_tokens" } },
      ),
    ).toEqual({ max_tokens: 99 });
  });

  it("applies set last, and extraSet overrides the row's set", () => {
    expect(
      adaptParams(
        { temperature: 0.5 },
        { drop: ["temperature"], set: { reasoning_effort: "low" } },
        { reasoning_effort: "medium" },
      ),
    ).toEqual({ reasoning_effort: "medium" });
  });

  it("does not mutate the input", () => {
    const params = { temperature: 0.5 };
    adaptParams(params, { drop: ["temperature"] });
    expect(params).toEqual({ temperature: 0.5 });
  });
});

describe("hostForModel", () => {
  it("pins OpenAI models to Azure and Google models to Vertex", () => {
    expect(hostForModel("openai/gpt-4o-mini")).toBe("azure");
    expect(hostForModel("openai/gpt-6-luna")).toBe("azure");
    expect(hostForModel("google/gemini-3.8-flash")).toBe("google-vertex");
  });
  it("has no host for an unlisted provider", () => {
    expect(hostForModel("anthropic/claude-sonnet-4.6")).toBeUndefined();
    expect(hostForModel("gpt-4o")).toBeUndefined();
  });
});
