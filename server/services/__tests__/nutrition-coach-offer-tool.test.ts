import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateCoachProResponse } from "../nutrition-coach";
import type { CoachContext } from "../nutrition-coach";
import { aiChat } from "../../lib/ai-client";
import { executeToolCall } from "../coach-tools";

vi.mock("../../lib/ai-client", () => ({ aiChat: vi.fn() }));
vi.mock("../../lib/openai", () => ({ OPENAI_TIMEOUT_STREAM_MS: 30_000 }));
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
  blocksPrompt: "DEFAULT_BLOCKS",
};

type Delta = {
  content?: string;
  tool_calls?: {
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }[];
  finish_reason?: string | null;
};

function mockStream(chunks: Delta[]) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) {
        yield {
          choices: [
            {
              delta: { content: c.content ?? null, tool_calls: c.tool_calls },
              finish_reason: c.finish_reason ?? null,
            },
          ],
        };
      }
    },
  };
}

const ARGS = '{"dish":"Chili","from_conversation":false}';

async function run(
  options?: { offerRecipe?: boolean },
  intent?: Parameters<typeof generateCoachProResponse>[5],
) {
  const out: unknown[] = [];
  for await (const c of generateCoachProResponse(
    [{ role: "user", content: "chili recipe" }],
    CONTEXT,
    "u1",
    undefined,
    undefined,
    intent,
    "UTC",
    options,
  )) {
    out.push(c);
  }
  return out;
}

function sentBody(call = 0) {
  return vi.mocked(aiChat).mock.calls[call][1] as unknown as {
    tools: { function: { name: string } }[];
    messages: { role: string; content: string }[];
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("RECIPE_FINDER_ENABLED", "true");
});
afterEach(() => vi.unstubAllEnvs());

describe("Coach Pro offer_recipe terminal tool", () => {
  it("yields exactly one terminal_tool and makes no second round", async () => {
    vi.mocked(aiChat).mockResolvedValue(
      mockStream([
        {
          tool_calls: [
            {
              index: 0,
              id: "c1",
              function: { name: "offer_recipe", arguments: ARGS },
            },
          ],
        },
        { finish_reason: "tool_calls" },
      ]) as unknown as Awaited<ReturnType<typeof aiChat>>,
    );
    const out = await run({ offerRecipe: true });
    expect(out).toEqual([
      { type: "terminal_tool", name: "offer_recipe", args: ARGS },
    ]);
    expect(aiChat).toHaveBeenCalledTimes(1);
  });

  it("uses the accumulated args when they arrive split across chunks", async () => {
    vi.mocked(aiChat).mockResolvedValue(
      mockStream([
        {
          tool_calls: [
            {
              index: 0,
              id: "c1",
              function: { name: "offer_recipe", arguments: '{"dish":"Chi' },
            },
          ],
        },
        {
          tool_calls: [
            {
              index: 0,
              function: { arguments: 'li","from_conversation":false}' },
            },
          ],
        },
        { finish_reason: "tool_calls" },
      ]) as unknown as Awaited<ReturnType<typeof aiChat>>,
    );
    expect(await run({ offerRecipe: true })).toEqual([
      { type: "terminal_tool", name: "offer_recipe", args: ARGS },
    ]);
  });

  it("drops other calls in the same round (no execution, no tool_calls chunk)", async () => {
    vi.mocked(aiChat).mockResolvedValue(
      mockStream([
        {
          tool_calls: [
            {
              index: 0,
              id: "c0",
              function: { name: "lookup_nutrition", arguments: "{}" },
            },
            {
              index: 1,
              id: "c1",
              function: { name: "offer_recipe", arguments: ARGS },
            },
          ],
        },
        { finish_reason: "tool_calls" },
      ]) as unknown as Awaited<ReturnType<typeof aiChat>>,
    );
    const out = await run({ offerRecipe: true });
    expect(out).toEqual([
      { type: "terminal_tool", name: "offer_recipe", args: ARGS },
    ]);
    expect(executeToolCall).not.toHaveBeenCalled();
    expect(aiChat).toHaveBeenCalledTimes(1);
  });

  it("yields pre-tool content before the terminal_tool", async () => {
    vi.mocked(aiChat).mockResolvedValue(
      mockStream([
        { content: "Sure!" },
        {
          tool_calls: [
            {
              index: 0,
              id: "c1",
              function: { name: "offer_recipe", arguments: ARGS },
            },
          ],
        },
        { finish_reason: "tool_calls" },
      ]) as unknown as Awaited<ReturnType<typeof aiChat>>,
    );
    expect(await run({ offerRecipe: true })).toEqual([
      { type: "content", content: "Sure!" },
      { type: "terminal_tool", name: "offer_recipe", args: ARGS },
    ]);
  });

  it("offers the tool (finder tools minus search_recipes) and the offer prompt when on", async () => {
    vi.mocked(aiChat).mockResolvedValue(
      mockStream([
        { content: "hi" },
        { finish_reason: "stop" },
      ]) as unknown as Awaited<ReturnType<typeof aiChat>>,
    );
    await run({ offerRecipe: true });
    expect(sentBody().tools.map((t) => t.function.name)).toEqual([
      "lookup_nutrition",
      "offer_recipe",
    ]);
    expect(sentBody().messages[0].content).toContain("offer_recipe tool");
    expect(sentBody().messages[0].content).not.toContain("DEFAULT_BLOCKS");
  });

  it("offerRecipe false or absent: no offer tool, caller's prompt untouched", async () => {
    for (const options of [{ offerRecipe: false }, undefined]) {
      vi.mocked(aiChat).mockResolvedValue(
        mockStream([
          { content: "hi" },
          { finish_reason: "stop" },
        ]) as unknown as Awaited<ReturnType<typeof aiChat>>,
      );
      await run(options);
    }
    for (const i of [0, 1]) {
      expect(sentBody(i).tools.map((t) => t.function.name)).toEqual([
        "lookup_nutrition",
      ]);
      expect(sentBody(i).messages[0].content).toContain("DEFAULT_BLOCKS");
    }
  });

  it("safety_refusal intent + offerRecipe: no tool AND the default blocks prompt", async () => {
    vi.mocked(aiChat).mockResolvedValue(
      mockStream([
        { content: "no" },
        { finish_reason: "stop" },
      ]) as unknown as Awaited<ReturnType<typeof aiChat>>,
    );
    await run({ offerRecipe: true }, "safety_refusal");
    expect(sentBody().tools.map((t) => t.function.name)).not.toContain(
      "offer_recipe",
    );
    expect(sentBody().messages[0].content).toContain("DEFAULT_BLOCKS");
  });
});
