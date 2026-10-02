import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateCoachProResponse } from "../nutrition-coach";
import type { CoachContext } from "../nutrition-coach";
import { openai } from "../../lib/openai";

vi.mock("../../lib/openai", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
  OPENAI_TIMEOUT_STREAM_MS: 30_000,
  MODEL_FAST: "gpt-4o-mini",
}));
vi.mock("../coach-tools", () => ({
  getToolDefinitions: vi.fn().mockReturnValue([
    {
      type: "function",
      function: {
        name: "lookup_nutrition",
        description: "d",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "search_recipes",
        description: "d",
        parameters: { type: "object", properties: {} },
      },
    },
  ]),
  executeToolCall: vi.fn(),
  MAX_TOOL_CALLS_PER_RESPONSE: 5,
  serviceUnavailable: vi.fn(),
}));
vi.mock("../../lib/ai-safety", () => ({
  sanitizeUserInput: vi.fn((t: string) => t),
  sanitizeContextField: vi.fn((t: string) => t),
  containsUnsafeCoachAdvice: vi.fn().mockReturnValue(false),
  SYSTEM_PROMPT_BOUNDARY: "---BOUNDARY---",
}));
vi.mock("../../lib/logger", () => ({
  createServiceLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
  toError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
}));

const CONTEXT: CoachContext = {
  goals: { calories: 2000, protein: 150, carbs: 250, fat: 65 },
  todayIntake: { calories: 800, protein: 40, carbs: 100, fat: 30 },
  dietaryProfile: { dietType: "balanced", allergies: [], dislikes: [] },
};

// Same chunk shape as nutrition-coach.test.ts's createMockStream (the tool
// loop reads choices[0].delta.{content,tool_calls} + finish_reason).
function createMockStream(
  chunks: { content?: string; finish_reason?: string | null }[],
) {
  const iterator = chunks[Symbol.iterator]();
  return {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          const result = iterator.next();
          if (result.done) return { done: true, value: undefined };
          const chunk = result.value;
          return {
            done: false,
            value: {
              choices: [
                {
                  delta: {
                    content: chunk.content ?? null,
                    tool_calls: undefined,
                  },
                  finish_reason: chunk.finish_reason ?? null,
                },
              ],
            },
          };
        },
      };
    },
  };
}

async function toolNamesSent(): Promise<string[]> {
  vi.mocked(openai.chat.completions.create).mockResolvedValue(
    createMockStream([{ content: "hi" }, { finish_reason: "stop" }]) as any,
  );
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for await (const _chunk of generateCoachProResponse(
    [{ role: "user", content: "hi" }],
    CONTEXT,
    "u1",
  )) {
    // drain
  }
  const body = vi.mocked(openai.chat.completions.create).mock.calls[0][0] as {
    tools: { function: { name: string } }[];
  };
  return body.tools.map((t) => t.function.name);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe("Coach Pro tool list vs RECIPE_FINDER_ENABLED", () => {
  it("control: flag off keeps search_recipes", async () => {
    vi.stubEnv("RECIPE_FINDER_ENABLED", "");
    expect(await toolNamesSent()).toEqual([
      "lookup_nutrition",
      "search_recipes",
    ]);
  });

  it("flag on retires search_recipes (recipe discovery goes only through the finder)", async () => {
    vi.stubEnv("RECIPE_FINDER_ENABLED", "true");
    expect(await toolNamesSent()).toEqual(["lookup_nutrition"]);
  });
});
