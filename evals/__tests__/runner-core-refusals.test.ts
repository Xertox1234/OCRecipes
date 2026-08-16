import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runEvalSuite } from "../lib/runner-core";
import type { SuiteConfig } from "../lib/runner-core";

/**
 * Refusal gates of runEvalSuite — kept in their own file because these tests
 * stub process.exit and env vars, and that must never leak into the pure-math
 * suite (runner-core.test.ts).
 *
 * runEvalSuite refuses via console.error + process.exit(1), so process.exit is
 * stubbed to throw a sentinel; each test asserts on the sentinel AND on which
 * message reached console.error (proving WHICH gate fired, in order).
 */

const minimalConfig: SuiteConfig = {
  suiteName: "Refusal Suite",
  rubricText: "",
  dimensions: [],
  dimensionWeights: {},
  generateResponse: async () => {
    throw new Error("generateResponse must never run in a refusal test");
  },
  formatInput: () => "",
};

describe("runEvalSuite refusal gates", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let argvLengthBefore: number;

  const loggedErrors = (): string =>
    errorSpy.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");

  beforeEach(() => {
    argvLengthBefore = process.argv.length;
    vi.spyOn(process, "exit").mockImplementation((code?) => {
      throw new Error(`exit:${code}`);
    });
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    // Deterministic env: the dev shell exports NODE_ENV=production (see
    // memory), and real keys may exist — stub all three every test.
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("AI_INTEGRATIONS_OPENAI_API_KEY", "");
  });

  afterEach(() => {
    process.argv.length = argvLengthBefore;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("REFUSES NODE_ENV=production before any other check runs", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(runEvalSuite([], minimalConfig)).rejects.toThrow("exit:1");
    expect(loggedErrors()).toContain(
      "refusing to run evals with NODE_ENV=production",
    );
    // The gate fired FIRST: the key checks were never reached, so no work
    // (and no spend) could have started.
    expect(loggedErrors()).not.toContain("ANTHROPIC_API_KEY");
  });

  it("--allow-prod releases the prod gate (non-vacuity control)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    process.argv.push("--allow-prod");
    await expect(runEvalSuite([], minimalConfig)).rejects.toThrow("exit:1");
    // Proves the gate actually released: the run proceeded to the NEXT
    // refusal (missing API key) instead of the prod refusal.
    expect(loggedErrors()).toContain("ANTHROPIC_API_KEY is required");
    expect(loggedErrors()).not.toContain("refusing to run evals");
  });

  it("REFUSES a run without ANTHROPIC_API_KEY (the judge cannot score)", async () => {
    await expect(runEvalSuite([], minimalConfig)).rejects.toThrow("exit:1");
    expect(loggedErrors()).toContain("ANTHROPIC_API_KEY is required");
  });

  it("REFUSES a run without AI_INTEGRATIONS_OPENAI_API_KEY (the service under eval cannot answer)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");
    await expect(runEvalSuite([], minimalConfig)).rejects.toThrow("exit:1");
    expect(loggedErrors()).toContain(
      "AI_INTEGRATIONS_OPENAI_API_KEY is required",
    );
  });
});
