import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { runEvalSuite } from "../lib/runner-core";
import type { SuiteConfig } from "../lib/runner-core";
import { getAiCallContext } from "../../server/lib/ai-call-context";
import { AI_FEATURES } from "../../server/lib/ai-models";
import type { EvalTestCase } from "../types";

const writeFileSync = vi.hoisted(() => vi.fn());
vi.mock("fs", async (orig) => {
  const actual = await orig<typeof import("fs")>();
  return {
    ...actual,
    writeFileSync,
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => true),
  };
});
vi.mock("../lib/eval-results-store", () => ({
  persistResults: vi.fn(async () => {}),
}));
vi.mock("../lib/judge-generic", () => ({
  resolveJudgeBackend: vi.fn(),
  currentJudgeModel: vi.fn(() => "judge-model"),
  judgeGeneric: vi.fn(async () => ({ scores: [], judgeModel: "judge-model" })),
}));

const testCase = {
  id: "case-1",
  category: "general",
  description: "d",
} as unknown as EvalTestCase;

const configWith = (generateResponse: SuiteConfig["generateResponse"]) =>
  ({
    suiteName: "Candidate Suite",
    rubricText: "",
    dimensions: [],
    dimensionWeights: {},
    generateResponse,
    formatInput: () => "",
  }) as SuiteConfig;

describe("runEvalSuite per-sample AI call checks", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let argvLengthBefore: number;
  const loggedErrors = (): string =>
    errorSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");

  beforeEach(() => {
    argvLengthBefore = process.argv.length;
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code?) => {
      throw new Error(`exit:${code}`);
    });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("AI_INTEGRATIONS_OPENAI_API_KEY", "sk-test");
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    writeFileSync.mockClear();
  });

  afterEach(() => {
    process.argv.length = argvLengthBefore;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("exits 1 and writes no report when a sample recorded no AI calls", async () => {
    const config = configWith(async () => ({
      text: "hi",
      latencyMs: 1,
      wordCount: 1,
    }));
    await expect(runEvalSuite([testCase], config)).rejects.toThrow("exit:1");
    expect(loggedErrors()).toMatch(/no AI calls recorded/);
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("a sample with a clean table-model record is not flagged", async () => {
    const model = AI_FEATURES["coach-chat"].model;
    const config = configWith(async () => {
      getAiCallContext()!.calls.push({
        feature: "coach-chat",
        requestedModel: model,
        answeredModel: model,
        answeredProvider: "Azure",
        fellBack: false,
      });
      return { text: "hi", latencyMs: 1, wordCount: 1 };
    });
    await runEvalSuite([testCase], config);
    // Without the per-sample context getAiCallContext() is undefined and the
    // stub throws — that would surface as an errored case, not a violation.
    expect(loggedErrors()).not.toMatch(/CASE ERRORED/);
    expect(loggedErrors()).not.toMatch(/not answered by the requested model/);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(writeFileSync).toHaveBeenCalled();
  });

  it("exits 1 and writes no report when a --candidate feature was never called", async () => {
    process.argv.push("--candidate", "coach-pro-chat=openai/gpt-6-luna");
    const config = configWith(async () => {
      getAiCallContext()!.calls.push({
        feature: "coach-chat",
        requestedModel: AI_FEATURES["coach-chat"].model,
        answeredModel: AI_FEATURES["coach-chat"].model,
        answeredProvider: "Azure",
        fellBack: false,
      });
      return { text: "hi", latencyMs: 1, wordCount: 1 };
    });
    await expect(runEvalSuite([testCase], config)).rejects.toThrow("exit:1");
    expect(loggedErrors()).toContain(
      "Error: --candidate names feature(s) no sample called: coach-pro-chat",
    );
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});
