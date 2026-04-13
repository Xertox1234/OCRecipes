import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateCoachProResponse } from "../nutrition-coach";
import type { CoachContext } from "../nutrition-coach";
import { openai } from "../../lib/openai";
import { executeToolCall } from "../coach-tools";

vi.mock("../../lib/openai", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
  OPENAI_TIMEOUT_STREAM_MS: 30_000,
  MODEL_FAST: "gpt-4o-mini",
}));

vi.mock("../coach-tools", () => ({
  getToolDefinitions: vi.fn().mockReturnValue([
    {
      type: "function",
      function: {
        name: "lookup_nutrition",
        description: "Look up nutrition",
        parameters: { type: "object", properties: {} },
      },
    },
  ]),
  executeToolCall: vi.fn(),
  MAX_TOOL_CALLS_PER_RESPONSE: 5,
}));

vi.mock("../../lib/ai-safety", () => ({
  sanitizeUserInput: vi.fn((text: string) => text),
  sanitizeContextField: vi.fn((text: string) => text),
  containsDangerousDietaryAdvice: vi.fn().mockReturnValue(false),
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

const DEFAULT_CONTEXT: CoachContext = {
  goals: { calories: 2000, protein: 150, carbs: 250, fat: 65 },
  todayIntake: { calories: 800, protein: 40, carbs: 100, fat: 30 },
  weightTrend: { currentWeight: 75, weeklyRate: -0.5 },
  dietaryProfile: { dietType: "balanced", allergies: [], dislikes: [] },
};

/**
 * Build a mock async iterable that mimics OpenAI's streaming response.
 * Each item in `chunks` corresponds to one SSE event from the API.
 */
function createMockStream(
  chunks: {
    content?: string;
    finish_reason?: string | null;
    tool_calls?: {
      index: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }[];
  }[],
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
                    tool_calls: chunk.tool_calls ?? undefined,
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

/** Collect all yielded chunks from an async generator into a single string. */
async function collectStream(gen: AsyncGenerator<string>): Promise<string> {
  let result = "";
  for await (const chunk of gen) {
    result += chunk;
  }
  return result;
}

describe("generateCoachProResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("streams text content from a simple response without tool calls", async () => {
    const stream = createMockStream([
      { content: "Hello " },
      { content: "there!" },
      { finish_reason: "stop" },
    ]);
    vi.mocked(openai.chat.completions.create).mockResolvedValue(stream as any);

    const messages = [{ role: "user" as const, content: "Hi" }];
    const result = await collectStream(
      generateCoachProResponse(messages, DEFAULT_CONTEXT, "user-1"),
    );

    expect(result).toBe("Hello there!");
    expect(executeToolCall).not.toHaveBeenCalled();
  });

  it("executes tool calls and continues conversation", async () => {
    // First API call: model requests a tool call
    const toolCallStream = createMockStream([
      {
        tool_calls: [
          {
            index: 0,
            id: "call_abc",
            function: { name: "lookup_nutrition", arguments: '{"query":' },
          },
        ],
      },
      {
        tool_calls: [
          {
            index: 0,
            function: { arguments: '"chicken"}' },
          },
        ],
      },
      { finish_reason: "tool_calls" },
    ]);

    // Second API call: model generates final text response
    const textStream = createMockStream([
      { content: "Chicken has 165 calories." },
      { finish_reason: "stop" },
    ]);

    vi.mocked(openai.chat.completions.create)
      .mockResolvedValueOnce(toolCallStream as any)
      .mockResolvedValueOnce(textStream as any);

    vi.mocked(executeToolCall).mockResolvedValue({
      name: "chicken",
      calories: 165,
    });

    const messages = [
      { role: "user" as const, content: "How many calories in chicken?" },
    ];
    const result = await collectStream(
      generateCoachProResponse(messages, DEFAULT_CONTEXT, "user-1"),
    );

    expect(result).toBe("Chicken has 165 calories.");
    expect(executeToolCall).toHaveBeenCalledWith(
      "lookup_nutrition",
      { query: "chicken" },
      "user-1",
    );
  });

  it("enforces MAX_TOOL_CALLS_PER_RESPONSE limit", async () => {
    // Create a stream that requests 6 tool calls at once (exceeding the limit of 5)
    const toolCalls: {
      index: number;
      id?: string;
      function?: { name?: string; arguments?: string };
    }[] = [];
    for (let i = 0; i < 6; i++) {
      toolCalls.push({
        index: i,
        id: `call_${i}`,
        function: {
          name: "lookup_nutrition",
          arguments: `{"query":"food_${i}"}`,
        },
      });
    }

    const bigToolCallStream = createMockStream([
      { tool_calls: toolCalls },
      { finish_reason: "tool_calls" },
    ]);

    vi.mocked(openai.chat.completions.create).mockResolvedValueOnce(
      bigToolCallStream as any,
    );

    vi.mocked(executeToolCall).mockResolvedValue({
      name: "food",
      calories: 100,
    });

    const messages = [{ role: "user" as const, content: "Look up 6 foods" }];
    const result = await collectStream(
      generateCoachProResponse(messages, DEFAULT_CONTEXT, "user-1"),
    );

    // Should break out of the loop without executing tools beyond the limit
    expect(result).toBeDefined();
    // executeToolCall should NOT have been called because the count check
    // happens before execution (toolCallCount += size = 6, then 6 > 5 = true)
    expect(executeToolCall).not.toHaveBeenCalled();
  });

  it("handles tool call execution errors gracefully", async () => {
    // First API call: model requests a tool call that will fail
    const toolCallStream = createMockStream([
      {
        tool_calls: [
          {
            index: 0,
            id: "call_fail",
            function: {
              name: "lookup_nutrition",
              arguments: '{"query":"bad food"}',
            },
          },
        ],
      },
      { finish_reason: "tool_calls" },
    ]);

    // Second API call: model generates response after getting error result
    const textStream = createMockStream([
      { content: "Sorry, I couldn't find that." },
      { finish_reason: "stop" },
    ]);

    vi.mocked(openai.chat.completions.create)
      .mockResolvedValueOnce(toolCallStream as any)
      .mockResolvedValueOnce(textStream as any);

    vi.mocked(executeToolCall).mockRejectedValue(
      new Error("Nutrition API timeout"),
    );

    const messages = [
      { role: "user" as const, content: "What about bad food?" },
    ];
    const result = await collectStream(
      generateCoachProResponse(messages, DEFAULT_CONTEXT, "user-1"),
    );

    // The generator should still yield text after the tool error
    expect(result).toBe("Sorry, I couldn't find that.");
    expect(executeToolCall).toHaveBeenCalledOnce();
  });

  it("builds multi-round conversation with tool results", async () => {
    // Round 1: tool call with partial text
    const round1Stream = createMockStream([
      { content: "Let me check " },
      {
        tool_calls: [
          {
            index: 0,
            id: "call_1",
            function: {
              name: "lookup_nutrition",
              arguments: '{"query":"rice"}',
            },
          },
        ],
      },
      { finish_reason: "tool_calls" },
    ]);

    // Round 2: another tool call
    const round2Stream = createMockStream([
      {
        tool_calls: [
          {
            index: 0,
            id: "call_2",
            function: {
              name: "lookup_nutrition",
              arguments: '{"query":"beans"}',
            },
          },
        ],
      },
      { finish_reason: "tool_calls" },
    ]);

    // Round 3: final text
    const round3Stream = createMockStream([
      { content: "Rice has 130 cal and beans have 120 cal." },
      { finish_reason: "stop" },
    ]);

    vi.mocked(openai.chat.completions.create)
      .mockResolvedValueOnce(round1Stream as any)
      .mockResolvedValueOnce(round2Stream as any)
      .mockResolvedValueOnce(round3Stream as any);

    vi.mocked(executeToolCall)
      .mockResolvedValueOnce({ name: "rice", calories: 130 })
      .mockResolvedValueOnce({ name: "beans", calories: 120 });

    const messages = [
      { role: "user" as const, content: "Compare rice and beans" },
    ];
    const result = await collectStream(
      generateCoachProResponse(messages, DEFAULT_CONTEXT, "user-1"),
    );

    expect(result).toBe(
      "Let me check Rice has 130 cal and beans have 120 cal.",
    );
    // OpenAI called 3 times (2 tool rounds + 1 final)
    expect(openai.chat.completions.create).toHaveBeenCalledTimes(3);
    // Two tool calls executed
    expect(executeToolCall).toHaveBeenCalledTimes(2);
  });

  it("yields error message when OpenAI API call fails", async () => {
    vi.mocked(openai.chat.completions.create).mockRejectedValue(
      new Error("API down"),
    );

    const messages = [{ role: "user" as const, content: "Hello" }];
    const result = await collectStream(
      generateCoachProResponse(messages, DEFAULT_CONTEXT, "user-1"),
    );

    expect(result).toBe(
      "Sorry, I'm having trouble responding right now. Please try again.",
    );
  });

  it("yields error message when streaming throws mid-stream", async () => {
    const errorStream = {
      [Symbol.asyncIterator]() {
        let count = 0;
        return {
          async next() {
            count++;
            if (count === 1) {
              return {
                done: false,
                value: {
                  choices: [
                    {
                      delta: { content: "Partial response" },
                      finish_reason: null,
                    },
                  ],
                },
              };
            }
            throw new Error("Stream interrupted");
          },
        };
      },
    };

    vi.mocked(openai.chat.completions.create).mockResolvedValue(
      errorStream as any,
    );

    const messages = [{ role: "user" as const, content: "Hello" }];
    const result = await collectStream(
      generateCoachProResponse(messages, DEFAULT_CONTEXT, "user-1"),
    );

    expect(result).toContain("Partial response");
    expect(result).toContain("Sorry, the response was interrupted");
  });

  it("handles parallel tool calls via Promise.allSettled", async () => {
    // Model requests 2 tool calls simultaneously
    const toolCallStream = createMockStream([
      {
        tool_calls: [
          {
            index: 0,
            id: "call_a",
            function: {
              name: "lookup_nutrition",
              arguments: '{"query":"apple"}',
            },
          },
          {
            index: 1,
            id: "call_b",
            function: {
              name: "lookup_nutrition",
              arguments: '{"query":"banana"}',
            },
          },
        ],
      },
      { finish_reason: "tool_calls" },
    ]);

    const textStream = createMockStream([
      { content: "Apple: 95 cal, Banana: 105 cal." },
      { finish_reason: "stop" },
    ]);

    vi.mocked(openai.chat.completions.create)
      .mockResolvedValueOnce(toolCallStream as any)
      .mockResolvedValueOnce(textStream as any);

    vi.mocked(executeToolCall)
      .mockResolvedValueOnce({ name: "apple", calories: 95 })
      .mockResolvedValueOnce({ name: "banana", calories: 105 });

    const messages = [
      { role: "user" as const, content: "Compare apple and banana" },
    ];
    const result = await collectStream(
      generateCoachProResponse(messages, DEFAULT_CONTEXT, "user-1"),
    );

    expect(result).toBe("Apple: 95 cal, Banana: 105 cal.");
    expect(executeToolCall).toHaveBeenCalledTimes(2);
    expect(executeToolCall).toHaveBeenCalledWith(
      "lookup_nutrition",
      { query: "apple" },
      "user-1",
    );
    expect(executeToolCall).toHaveBeenCalledWith(
      "lookup_nutrition",
      { query: "banana" },
      "user-1",
    );
  });

  it("handles mixed success/failure in parallel tool calls", async () => {
    const toolCallStream = createMockStream([
      {
        tool_calls: [
          {
            index: 0,
            id: "call_ok",
            function: {
              name: "lookup_nutrition",
              arguments: '{"query":"apple"}',
            },
          },
          {
            index: 1,
            id: "call_fail",
            function: {
              name: "lookup_nutrition",
              arguments: '{"query":"unknown"}',
            },
          },
        ],
      },
      { finish_reason: "tool_calls" },
    ]);

    const textStream = createMockStream([
      { content: "I found apple but not the other." },
      { finish_reason: "stop" },
    ]);

    vi.mocked(openai.chat.completions.create)
      .mockResolvedValueOnce(toolCallStream as any)
      .mockResolvedValueOnce(textStream as any);

    vi.mocked(executeToolCall)
      .mockResolvedValueOnce({ name: "apple", calories: 95 })
      .mockRejectedValueOnce(new Error("Not found"));

    const messages = [
      { role: "user" as const, content: "Look up apple and unknown" },
    ];
    const result = await collectStream(
      generateCoachProResponse(messages, DEFAULT_CONTEXT, "user-1"),
    );

    expect(result).toBe("I found apple but not the other.");
    expect(executeToolCall).toHaveBeenCalledTimes(2);
  });

  it("passes correct context including notebook and screen to system prompt", async () => {
    const stream = createMockStream([
      { content: "Ok" },
      { finish_reason: "stop" },
    ]);
    vi.mocked(openai.chat.completions.create).mockResolvedValue(stream as any);

    const context: CoachContext = {
      ...DEFAULT_CONTEXT,
      notebookSummary: "User is vegetarian and likes salads",
      screenContext: "Viewing home screen",
    };

    const messages = [{ role: "user" as const, content: "Hi" }];
    await collectStream(generateCoachProResponse(messages, context, "user-1"));

    const callArgs = vi.mocked(openai.chat.completions.create).mock.calls[0][0];
    const systemMsg = (
      callArgs as { messages: { role: string; content: string }[] }
    ).messages[0];
    expect(systemMsg.role).toBe("system");
    expect(systemMsg.content).toContain("vegetarian");
    expect(systemMsg.content).toContain("salads");
    expect(systemMsg.content).toContain("home screen");
  });
});
