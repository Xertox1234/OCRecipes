// server/lib/__tests__/ai-models.test.ts
// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  AI_FEATURES,
  adaptParams,
  hostForModel,
  isAiFeature,
  VERTEX_BACKUP,
  type AiFeatureConfig,
} from "../ai-models";

describe("AI_FEATURES table", () => {
  const rows: [string, AiFeatureConfig][] = Object.entries(AI_FEATURES);

  it("has one row per call site (34)", () => {
    expect(rows).toHaveLength(34);
  });

  it("every model has a provider/ prefix", () => {
    for (const [name, row] of rows) {
      expect(row.model, name).toMatch(/^[a-z0-9-]+\/[^/]+$/);
    }
  });

  // Owner-approved switches (spec §6 step 5). Every other row still runs
  // gpt-4o or gpt-4o-mini with no adapt.
  const SWITCHED: Record<string, AiFeatureConfig> = {
    "coach-chat": {
      model: "openai/gpt-6-luna",
      vertexBackup: VERTEX_BACKUP,
      json: false,
      vision: false,
      adapt: { drop: ["temperature"], set: { reasoning_effort: "low" } },
    },
    "coach-pro-chat": {
      model: "openai/gpt-6-luna",
      vertexBackup: VERTEX_BACKUP,
      json: false,
      vision: false,
      adapt: { drop: ["temperature"], set: { reasoning_effort: "low" } },
    },
    // Owner-approved 2026-10-17 after a paired eval (spec
    // 2026-10-17-recipe-generate-argon-background-completion §1): Gemini keeps
    // `temperature`, reports no reasoning tokens, and OpenRouter honours
    // `max_completion_tokens` for it — so no adapt block.
    "recipe-generate": {
      model: "google/gemini-4-argon",
      vertexBackup: VERTEX_BACKUP,
      json: true,
      vision: false,
    },
    // Owner-approved 2026-10-19 after a paired eval (todo
    // P2-2026-10-18-camera-vision-features-to-gemini, Updates): low reasoning
    // keeps the JSON reply inside its token cap.
    "photo-analyze": {
      model: "google/gemini-3.8-flash",
      vertexBackup: VERTEX_BACKUP,
      json: true,
      vision: true,
      adapt: { set: { reasoning_effort: "low" } },
    },
    // Owner-approved 2026-11-05 after a paired eval with the no-invented-zeros
    // prompt (todo P2-2026-10-18-camera-vision-features-to-gemini, Updates).
    "photo-label": {
      model: "google/gemini-3.8-flash",
      vertexBackup: VERTEX_BACKUP,
      json: true,
      vision: true,
      adapt: { set: { reasoning_effort: "low" } },
    },
    // Owner-approved 2026-11-05 after a paired eval (todo
    // P2-2026-10-18-camera-vision-features-to-gemini, Updates).
    "front-label-scan": {
      model: "google/gemini-3.8-flash",
      vertexBackup: VERTEX_BACKUP,
      json: true,
      vision: true,
      adapt: { set: { reasoning_effort: "low" } },
    },
    // Owner-approved 2026-11-06 after paired evals (todo
    // P2-2026-10-18-camera-vision-features-to-gemini, Updates).
    "cooking-ingredient-photo": {
      model: "google/gemini-3.8-flash",
      vertexBackup: VERTEX_BACKUP,
      json: true,
      vision: true,
      adapt: { set: { reasoning_effort: "low" } },
    },
    "photo-classify": {
      model: "google/gemini-3.8-flash",
      vertexBackup: VERTEX_BACKUP,
      json: true,
      vision: true,
      adapt: { set: { reasoning_effort: "low" } },
    },
    // Owner-approved 2026-11-02 after a paired eval (todo
    // P2-2026-10-17-recipe-chat-row-model-eval-before-switch, Updates).
    "recipe-chat": {
      model: "google/gemini-3.8-flash",
      vertexBackup: VERTEX_BACKUP,
      json: false,
      vision: false,
      adapt: { set: { reasoning_effort: "low" } },
    },
  };

  it("switched rows are exactly the approved ones", () => {
    for (const [name, row] of Object.entries(SWITCHED)) {
      expect(AI_FEATURES[name as keyof typeof AI_FEATURES], name).toEqual(row);
    }
  });

  it("every other row is gpt-4o or gpt-4o-mini with no adapt", () => {
    for (const [name, row] of rows) {
      if (name in SWITCHED) continue;
      expect(["openai/gpt-4o", "openai/gpt-4o-mini"], name).toContain(
        row.model,
      );
      expect(row.adapt, name).toBeUndefined();
    }
  });

  it("every row's model has a pinned OpenRouter host", () => {
    for (const [name, row] of rows) {
      expect(hostForModel(row.model), name).toBeDefined();
    }
  });

  it("a Vertex-first row runs a Google model", () => {
    for (const [name, row] of rows) {
      if (row.primary === "vertex")
        expect(row.model, name).toMatch(/^google\//);
    }
  });

  // OpenAI direct shuts gpt-4o/mini down on 2027-01-14: the OpenAI-direct
  // `fallback` route is gone, and only a Vertex-first row may lack the backup.
  it("the row type has no OpenAI fallback and requires a backup", () => {
    const withFallback: AiFeatureConfig = {
      model: "openai/gpt-4o",
      // @ts-expect-error — no OpenAI-direct fallback route any more
      fallback: "gpt-4o",
      vertexBackup: VERTEX_BACKUP,
      json: true,
      vision: false,
    };
    // @ts-expect-error — an OpenRouter-primary row needs the Vertex backup
    const noBackup: AiFeatureConfig = {
      model: "openai/gpt-4o",
      json: true,
      vision: false,
    };
    const vertexFirst: AiFeatureConfig = {
      model: "google/gemini-3.8-flash",
      primary: "vertex",
      json: true,
      vision: true,
    };
    expect([withFallback, noBackup, vertexFirst]).toHaveLength(3);
  });

  // Rollout complete (spec 2026-11-02-vertex-backup-route-design; owner
  // 2026-11-03): OpenAI direct shuts gpt-4o/mini down on 2027-01-14, so no
  // row may fall back to it — text and vision rows alike back up to Vertex.
  it("every row backs up to Vertex, never OpenAI", () => {
    for (const [name, row] of rows) {
      expect(row.vertexBackup, name).toBe(VERTEX_BACKUP);
    }
  });

  it("a vertexBackup row uses the shared VERTEX_BACKUP constant", () => {
    for (const [name, row] of rows) {
      if (row.vertexBackup !== undefined)
        expect(row.vertexBackup, name).toBe(VERTEX_BACKUP);
    }
  });

  it("VERTEX_BACKUP is Gemini 3.8 Flash at low reasoning", () => {
    expect(VERTEX_BACKUP).toEqual({
      model: "google/gemini-3.8-flash",
      adapt: { set: { reasoning_effort: "low" } },
    });
    expect(hostForModel(VERTEX_BACKUP.model)).toBeDefined();
  });

  // Rollout allowlist (spec 2026-10-19-vision-rows-vertex-direct §2.1): grows
  // PR by PR until every vision row is here, then this test asserts all of them.
  const VERTEX_FIRST: string[] = [];
  it("Vertex-first rows are exactly the rolled-out ones", () => {
    const flagged = rows
      .filter(([, row]) => row.primary === "vertex")
      .map(([name]) => name)
      .sort();
    expect(flagged).toEqual([...VERTEX_FIRST].sort());
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
