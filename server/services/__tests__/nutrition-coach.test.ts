import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateCoachProResponse,
  generateCoachResponse,
  SAFETY_OVERRIDE_SENTINEL,
} from "../nutrition-coach";
import type { CoachContext } from "../nutrition-coach";
import { openai } from "../../lib/openai";
import { executeToolCall } from "../coach-tools";
import {
  sanitizeUserInput,
  sanitizeContextField,
  containsUnsafeCoachAdvice,
} from "../../lib/ai-safety";

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
  serviceUnavailable: vi.fn((toolName: string) => ({
    error: true,
    code: "SERVICE_UNAVAILABLE",
    message: `${toolName} is temporarily unavailable`,
  })),
}));

vi.mock("../../lib/ai-safety", () => ({
  sanitizeUserInput: vi.fn((text: string) => text),
  sanitizeContextField: vi.fn((text: string) => text),
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

const DEFAULT_CONTEXT: CoachContext = {
  goals: { calories: 2000, protein: 150, carbs: 250, fat: 65 },
  todayIntake: { calories: 800, protein: 40, carbs: 100, fat: 30 },
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

  it("sanitizes all message roles before sending history to OpenAI", async () => {
    const stream = createMockStream([
      { content: "Hello" },
      { finish_reason: "stop" },
    ]);
    vi.mocked(openai.chat.completions.create).mockResolvedValue(stream as any);
    vi.mocked(sanitizeUserInput).mockImplementation((text) => `USER:${text}`);
    vi.mocked(sanitizeContextField).mockImplementation((text) => `CTX:${text}`);

    const messages = [
      { role: "system" as const, content: "stored system payload" },
      { role: "assistant" as const, content: "stored assistant payload" },
      { role: "user" as const, content: "user prompt" },
    ];

    await collectStream(
      generateCoachProResponse(messages, DEFAULT_CONTEXT, "user-1"),
    );

    const callArgs = vi.mocked(openai.chat.completions.create).mock.calls[0][0];
    const sentMessages = (
      callArgs as { messages: { role: string; content: string }[] }
    ).messages;
    expect(sentMessages.slice(1, 4)).toEqual([
      { role: "system", content: "CTX:stored system payload" },
      { role: "assistant", content: "CTX:stored assistant payload" },
      { role: "user", content: "USER:user prompt" },
    ]);
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
      undefined,
      "UTC",
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

  it("short-circuits with serviceUnavailable when tool args are malformed JSON", async () => {
    // First round: model emits a tool call whose arguments JSON is truncated /
    // syntactically invalid (e.g. finish_reason === "length" cut it off).
    const toolCallStream = createMockStream([
      {
        tool_calls: [
          {
            index: 0,
            id: "call_bad_json",
            function: {
              name: "lookup_nutrition",
              arguments: '{"query":"chick', // unterminated string — JSON.parse throws
            },
          },
        ],
      },
      { finish_reason: "tool_calls" },
    ]);

    const textStream = createMockStream([
      { content: "Something went wrong." },
      { finish_reason: "stop" },
    ]);

    vi.mocked(openai.chat.completions.create)
      .mockResolvedValueOnce(toolCallStream as any)
      .mockResolvedValueOnce(textStream as any);

    const messages = [
      { role: "user" as const, content: "calories in chicken" },
    ];
    const result = await collectStream(
      generateCoachProResponse(messages, DEFAULT_CONTEXT, "user-1"),
    );

    // executeToolCall must NOT be invoked when JSON.parse fails.
    expect(executeToolCall).not.toHaveBeenCalled();
    expect(result).toBe("Something went wrong.");
  });

  it("short-circuits with serviceUnavailable when tool args parse to a non-object", async () => {
    // Model returns valid JSON that is not an object (array / primitive).
    const toolCallStream = createMockStream([
      {
        tool_calls: [
          {
            index: 0,
            id: "call_array_args",
            function: {
              name: "lookup_nutrition",
              arguments: "[1,2,3]",
            },
          },
        ],
      },
      { finish_reason: "tool_calls" },
    ]);

    const textStream = createMockStream([
      { content: "I couldn't process that." },
      { finish_reason: "stop" },
    ]);

    vi.mocked(openai.chat.completions.create)
      .mockResolvedValueOnce(toolCallStream as any)
      .mockResolvedValueOnce(textStream as any);

    const messages = [{ role: "user" as const, content: "weird" }];
    const result = await collectStream(
      generateCoachProResponse(messages, DEFAULT_CONTEXT, "user-1"),
    );

    // Non-object args must be rejected before executeToolCall runs.
    expect(executeToolCall).not.toHaveBeenCalled();
    expect(result).toBe("I couldn't process that.");
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

  it("yields error message without partial content when streaming throws mid-stream", async () => {
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

    expect(result).toBe(
      "Sorry, the response was interrupted. Please try again.",
    );
    expect(result).not.toContain("Partial response");
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
      undefined,
      "UTC",
    );
    expect(executeToolCall).toHaveBeenCalledWith(
      "lookup_nutrition",
      { query: "banana" },
      "user-1",
      undefined,
      "UTC",
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

describe("generateCoachResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(containsUnsafeCoachAdvice).mockReturnValue(false);
  });

  it("sanitizes all message roles before sending history to OpenAI", async () => {
    const stream = createMockStream([
      { content: "Hello!" },
      { finish_reason: "stop" },
    ]);
    vi.mocked(openai.chat.completions.create).mockResolvedValue(stream as any);
    vi.mocked(sanitizeUserInput).mockImplementation((text) => `USER:${text}`);
    vi.mocked(sanitizeContextField).mockImplementation((text) => `CTX:${text}`);

    const messages = [
      { role: "system" as const, content: "stored system payload" },
      { role: "assistant" as const, content: "stored assistant payload" },
      { role: "user" as const, content: "Tell me about pizza" },
    ];
    await collectStream(generateCoachResponse(messages, DEFAULT_CONTEXT));

    const callArgs = vi.mocked(openai.chat.completions.create).mock.calls[0][0];
    const sentMessages = (
      callArgs as { messages: { role: string; content: string }[] }
    ).messages;
    expect(sentMessages.slice(1, 4)).toEqual([
      { role: "system", content: "CTX:stored system payload" },
      { role: "assistant", content: "CTX:stored assistant payload" },
      { role: "user", content: "USER:Tell me about pizza" },
    ]);
  });

  it("yields SAFETY_OVERRIDE_SENTINEL as last chunk when response is unsafe", async () => {
    const longContent = "A".repeat(250);
    const stream = createMockStream([
      { content: longContent },
      { finish_reason: "stop" },
    ]);
    vi.mocked(openai.chat.completions.create).mockResolvedValue(stream as any);
    vi.mocked(containsUnsafeCoachAdvice).mockReturnValue(true);

    const messages = [{ role: "user" as const, content: "Extreme diet plan" }];
    const chunks: string[] = [];
    for await (const chunk of generateCoachResponse(
      messages,
      DEFAULT_CONTEXT,
    )) {
      chunks.push(chunk);
    }

    // First chunk is the delta content (already streamed)
    expect(chunks[0]).toBe(longContent);
    // Last chunk is the sentinel signal
    expect(chunks[chunks.length - 1]).toBe(SAFETY_OVERRIDE_SENTINEL);
    // Safe message is NOT directly returned by generateCoachResponse
    expect(chunks.join("")).not.toContain("I need to be careful");
  });

  it("injects screenContext into the system prompt", async () => {
    const stream = createMockStream([
      { content: "Ok" },
      { finish_reason: "stop" },
    ]);
    vi.mocked(openai.chat.completions.create).mockResolvedValue(stream as any);

    const context: CoachContext = {
      ...DEFAULT_CONTEXT,
      screenContext: "Viewing daily log screen",
    };

    const messages = [{ role: "user" as const, content: "Hi" }];
    await collectStream(generateCoachResponse(messages, context));

    const callArgs = vi.mocked(openai.chat.completions.create).mock.calls[0][0];
    const systemMsg = (
      callArgs as { messages: { role: string; content: string }[] }
    ).messages[0];
    expect(systemMsg.role).toBe("system");
    expect(systemMsg.content).toContain("Viewing daily log screen");
  });

  it("streams text content from the async generator", async () => {
    const stream = createMockStream([
      { content: "Great " },
      { content: "question!" },
      { finish_reason: "stop" },
    ]);
    vi.mocked(openai.chat.completions.create).mockResolvedValue(stream as any);

    const messages = [{ role: "user" as const, content: "What should I eat?" }];
    const result = await collectStream(
      generateCoachResponse(messages, DEFAULT_CONTEXT),
    );

    expect(result).toBe("Great question!");
  });

  it("yields error message when OpenAI API call fails", async () => {
    vi.mocked(openai.chat.completions.create).mockRejectedValue(
      new Error("API down"),
    );

    const messages = [{ role: "user" as const, content: "Hello" }];
    const result = await collectStream(
      generateCoachResponse(messages, DEFAULT_CONTEXT),
    );

    expect(result).toBe(
      "Sorry, I'm having trouble responding right now. Please try again.",
    );
  });

  it("does not stream unsafe final content before the safety fallback", async () => {
    const stream = createMockStream([
      { content: "Here is advice." },
      { finish_reason: "stop" },
    ]);
    vi.mocked(openai.chat.completions.create).mockResolvedValue(stream as any);
    vi.mocked(containsUnsafeCoachAdvice).mockReturnValue(true);

    const messages = [{ role: "user" as const, content: "Fasting plan" }];
    const chunks: string[] = [];
    for await (const chunk of generateCoachResponse(
      messages,
      DEFAULT_CONTEXT,
    )) {
      chunks.push(chunk);
    }

    // The sentinel is yielded as the last chunk — safe message not returned directly
    expect(chunks[chunks.length - 1]).toBe(SAFETY_OVERRIDE_SENTINEL);
    // The unsafe content was streamed (already in deltas) but safe msg is NOT in generateCoachResponse output
    expect(chunks.join("")).not.toContain(
      "I need to be careful here. I can't provide unsafe diet instructions",
    );
  });

  it("yields each delta individually rather than the full response at once", async () => {
    const stream = createMockStream([
      { content: "Hello " },
      { content: "there!" },
      { finish_reason: "stop" },
    ]);
    vi.mocked(openai.chat.completions.create).mockResolvedValue(stream as any);
    vi.mocked(containsUnsafeCoachAdvice).mockReturnValue(false);

    const chunks: string[] = [];
    for await (const chunk of generateCoachResponse(
      [{ role: "user", content: "Hi" }],
      DEFAULT_CONTEXT,
    )) {
      chunks.push(chunk);
    }

    // Must yield two separate chunks, not one concatenated string
    expect(chunks).toEqual(["Hello ", "there!"]);
  });

  it("includes a vague-message clarifying-question instruction in the system prompt", async () => {
    const stream = createMockStream([
      { content: "Ok" },
      { finish_reason: "stop" },
    ]);
    vi.mocked(openai.chat.completions.create).mockResolvedValue(stream as any);

    // "Hi" routes to vague_request — prompt should include the number-anchored
    // clarifying question instruction from that intent bundle.
    const messages = [{ role: "user" as const, content: "Hi" }];
    await collectStream(generateCoachResponse(messages, DEFAULT_CONTEXT));

    const callArgs = vi.mocked(openai.chat.completions.create).mock.calls[0][0];
    const systemMsg = (
      callArgs as { messages: { role: string; content: string }[] }
    ).messages[0];
    expect(systemMsg.content).toContain(
      "HOW TO HANDLE VAGUE OR UNCLEAR MESSAGES",
    );
  });

  it("includes an over-goal graceful-acknowledgment example in the system prompt", async () => {
    const stream = createMockStream([
      { content: "Ok" },
      { finish_reason: "stop" },
    ]);
    vi.mocked(openai.chat.completions.create).mockResolvedValue(stream as any);

    // Personalized message routes to personalized_advice — prompt should include
    // the graceful over-goal acknowledgment example from that bundle.
    const messages = [
      {
        role: "user" as const,
        content: "I really overdid it today, I've eaten way too much",
      },
    ];
    await collectStream(generateCoachResponse(messages, DEFAULT_CONTEXT));

    const callArgs = vi.mocked(openai.chat.completions.create).mock.calls[0][0];
    const systemMsg = (
      callArgs as { messages: { role: string; content: string }[] }
    ).messages[0];
    expect(systemMsg.content).toContain("One heavier day");
  });

  it("includes SYSTEM_PROMPT_BOUNDARY at end of system prompt", async () => {
    const stream = createMockStream([
      { content: "Ok" },
      { finish_reason: "stop" },
    ]);
    vi.mocked(openai.chat.completions.create).mockResolvedValue(stream as any);

    const messages = [{ role: "user" as const, content: "Hi" }];
    await collectStream(generateCoachResponse(messages, DEFAULT_CONTEXT));

    const callArgs = vi.mocked(openai.chat.completions.create).mock.calls[0][0];
    const systemMsg = (
      callArgs as { messages: { role: string; content: string }[] }
    ).messages[0];
    expect(systemMsg.content).toContain("---BOUNDARY---");
  });
});

describe("ABOUT THIS USER rendering", () => {
  function capturedSystemPrompt(): string {
    const callArgs = vi.mocked(openai.chat.completions.create).mock.calls[0][0];
    return (callArgs as { messages: { role: string; content: string }[] })
      .messages[0].content;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(containsUnsafeCoachAdvice).mockReturnValue(false);
    // clearAllMocks does NOT undo mockImplementation overrides from earlier
    // sanitization tests (USER:/CTX: prefixes) — restore identity explicitly.
    vi.mocked(sanitizeUserInput).mockImplementation((text: string) => text);
    vi.mocked(sanitizeContextField).mockImplementation((text: string) => text);
    const stream = createMockStream([
      { content: "Ok" },
      { finish_reason: "stop" },
    ]);
    vi.mocked(openai.chat.completions.create).mockResolvedValue(stream as any);
  });

  it("renders all set fields as labeled lines, humanizing snake_case values", async () => {
    const context: CoachContext = {
      ...DEFAULT_CONTEXT,
      aboutUser: {
        primaryGoal: "lose_weight",
        activityLevel: "lightly_active",
        cookingSkillLevel: "beginner",
        cookingTimeAvailable: "under_30_min",
        cuisinePreferences: ["Mexican", "Thai"],
        householdSize: 3,
        weightKg: 82.5,
        goalWeightKg: 75,
        measurementUnit: "metric",
      },
    };

    const messages = [{ role: "user" as const, content: "Hi" }];
    await collectStream(generateCoachResponse(messages, context));

    const prompt = capturedSystemPrompt();
    expect(prompt).toContain("ABOUT THIS USER:");
    expect(prompt).toContain("Primary goal: lose weight");
    expect(prompt).toContain("Weight: 82.5 kg (goal: 75 kg)");
    expect(prompt).toContain("Activity level: lightly active");
    expect(prompt).toContain("Favorite cuisines: Mexican, Thai");
    expect(prompt).toContain("Cooking skill: beginner");
    expect(prompt).toContain("Cooking time available: under 30 min");
    expect(prompt).toContain("Cooks for: 3 people");
  });

  it("renders weights in the user's display unit for imperial users", async () => {
    const context: CoachContext = {
      ...DEFAULT_CONTEXT,
      aboutUser: {
        weightKg: 82.5,
        goalWeightKg: 75,
        measurementUnit: "imperial",
      },
    };

    const messages = [{ role: "user" as const, content: "Hi" }];
    await collectStream(generateCoachResponse(messages, context));

    // kg → lbs conversion, rounded to 1 decimal at this leaf render site.
    expect(capturedSystemPrompt()).toContain(
      "Weight: 181.9 lbs (goal: 165.3 lbs)",
    );
  });

  it("omits unset lines and renders a lone goal weight without a current weight", async () => {
    const context: CoachContext = {
      ...DEFAULT_CONTEXT,
      aboutUser: {
        primaryGoal: "maintain",
        goalWeightKg: 75,
        measurementUnit: "metric",
      },
    };

    const messages = [{ role: "user" as const, content: "Hi" }];
    await collectStream(generateCoachResponse(messages, context));

    const prompt = capturedSystemPrompt();
    expect(prompt).toContain("Primary goal: maintain");
    expect(prompt).toContain("Goal weight: 75 kg");
    expect(prompt).not.toContain("Weight: ");
    expect(prompt).not.toContain("Activity level:");
    expect(prompt).not.toContain("Favorite cuisines:");
    expect(prompt).not.toContain("Cooks for:");
  });

  it("renders allergy severity labels and a severe-allergy caution", async () => {
    const context: CoachContext = {
      ...DEFAULT_CONTEXT,
      dietaryProfile: {
        dietType: "balanced",
        allergies: [
          { name: "peanuts", severity: "severe" },
          { name: "dairy", severity: "mild" },
        ],
        dislikes: [],
      },
    };

    const messages = [{ role: "user" as const, content: "Hi" }];
    await collectStream(generateCoachResponse(messages, context));

    const prompt = capturedSystemPrompt();
    expect(prompt).toContain("Allergies: peanuts (severe), dairy (mild)");
    expect(prompt).toContain("SEVERE");
    expect(prompt).toContain("cross-contamination");
  });

  it("renders severity-less allergies as plain names with no severe caution", async () => {
    const context: CoachContext = {
      ...DEFAULT_CONTEXT,
      dietaryProfile: {
        dietType: "balanced",
        allergies: [{ name: "shellfish" }],
        dislikes: [],
      },
    };

    const messages = [{ role: "user" as const, content: "Hi" }];
    await collectStream(generateCoachResponse(messages, context));

    const prompt = capturedSystemPrompt();
    expect(prompt).toContain("Allergies: shellfish");
    expect(prompt).not.toContain("cross-contamination");
  });

  it("renders no ABOUT THIS USER section when aboutUser is absent", async () => {
    const messages = [{ role: "user" as const, content: "Hi" }];
    await collectStream(generateCoachResponse(messages, DEFAULT_CONTEXT));

    expect(capturedSystemPrompt()).not.toContain("ABOUT THIS USER");
  });

  it("includes the profile-fit coaching bullets in the personalized_advice block", async () => {
    const messages = [
      { role: "user" as const, content: "What should I eat for dinner?" },
    ];
    await collectStream(generateCoachResponse(messages, DEFAULT_CONTEXT));

    const prompt = capturedSystemPrompt();
    expect(prompt).toContain(
      "never suggest a recipe that exceeds their stated time budget",
    );
    expect(prompt).toContain("default to the user's favorite cuisines");
    expect(prompt).toContain("never use shame framing");
    expect(prompt).toContain("never with urgency or deadline pressure");
  });
});

describe("current time rendering", () => {
  // 2026-07-11 01:12 UTC — Saturday 1:12 AM in UTC, Friday 6:12 PM in LA (PDT).
  const FIXED_INSTANT = new Date(Date.UTC(2026, 6, 11, 1, 12));

  function capturedSystemPrompt(): string {
    const callArgs = vi.mocked(openai.chat.completions.create).mock.calls[0][0];
    return (callArgs as { messages: { role: string; content: string }[] })
      .messages[0].content;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(containsUnsafeCoachAdvice).mockReturnValue(false);
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_INSTANT);
    const stream = createMockStream([
      { content: "Ok" },
      { finish_reason: "stop" },
    ]);
    vi.mocked(openai.chat.completions.create).mockResolvedValue(stream as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the current time in the user's timezone on the free path", async () => {
    const messages = [{ role: "user" as const, content: "Hi" }];
    await collectStream(
      generateCoachResponse(
        messages,
        DEFAULT_CONTEXT,
        undefined,
        undefined,
        "America/Los_Angeles",
      ),
    );

    expect(capturedSystemPrompt()).toContain(
      "Current time for this user: Friday 6:12 PM",
    );
  });

  it("defaults to UTC when the caller provides no timezone", async () => {
    const messages = [{ role: "user" as const, content: "Hi" }];
    await collectStream(generateCoachResponse(messages, DEFAULT_CONTEXT));

    expect(capturedSystemPrompt()).toContain(
      "Current time for this user: Saturday 1:12 AM",
    );
  });

  it("renders the user's timezone on the Pro path (tz already a param)", async () => {
    const messages = [{ role: "user" as const, content: "Hi" }];
    await collectStream(
      generateCoachProResponse(
        messages,
        DEFAULT_CONTEXT,
        "user-1",
        undefined,
        undefined,
        undefined,
        undefined,
        "America/Los_Angeles",
      ),
    );

    expect(capturedSystemPrompt()).toContain(
      "Current time for this user: Friday 6:12 PM",
    );
  });
});
