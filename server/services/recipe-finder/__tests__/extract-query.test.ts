import { describe, it, expect, vi, beforeEach } from "vitest";
import { extractQuery, rawQuery } from "../extract-query";
import { openai } from "../../../lib/openai";
import { createMockChatCompletion } from "../../../__tests__/factories";

vi.mock("../../../lib/openai", () => ({
  openai: { chat: { completions: { create: vi.fn() } } },
  OPENAI_TIMEOUT_FAST_MS: 15_000,
  MODEL_FAST: "gpt-4o-mini",
}));

vi.mock("../../../lib/ai-safety", () => ({
  sanitizeUserInput: vi.fn((t: string) => t),
  sanitizeContextField: vi.fn((t: string) => t),
  validateAiResponse: vi.fn(
    (
      data: unknown,
      schema: {
        safeParse: (d: unknown) => { success: boolean; data?: unknown };
      },
    ) => {
      const r = schema.safeParse(data);
      return r.success ? r.data : null;
    },
  ),
  SYSTEM_PROMPT_BOUNDARY: "---BOUNDARY---",
}));

const mockCreate = vi.mocked(openai.chat.completions.create);

function aiReturns(json: unknown) {
  mockCreate.mockResolvedValue(createMockChatCompletion(JSON.stringify(json)));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("extractQuery", () => {
  it("maps the AI JSON onto a RecipeQuery, dropping nulls", async () => {
    aiReturns({
      q: "quinoa salad",
      cuisine: "mediterranean",
      diet: null,
      maxPrepTime: 20,
      mealType: "lunch",
    });
    await expect(
      extractQuery("a quick mediterranean quinoa salad for lunch"),
    ).resolves.toEqual({
      q: "quinoa salad",
      cuisine: "mediterranean",
      maxPrepTime: 20,
      mealType: "lunch",
    });
    const call = mockCreate.mock.calls[0][0] as {
      response_format: unknown;
      model: string;
    };
    expect(call.response_format).toEqual({ type: "json_object" });
    expect(call.model).toBe("gpt-4o-mini");
  });

  it("drops an invalid optional field but keeps q", async () => {
    aiReturns({ q: "pancakes", mealType: "brunch", maxPrepTime: -5 });
    await expect(extractQuery("pancakes for brunch")).resolves.toEqual({
      q: "pancakes",
    });
  });

  it("searches the raw text when the AI call throws (timeout)", async () => {
    mockCreate.mockRejectedValue(new Error("Request timed out."));
    await expect(extractQuery("Mediterranean")).resolves.toEqual({
      q: "Mediterranean",
    });
  });

  it("searches the raw text on invalid JSON", async () => {
    mockCreate.mockResolvedValue(createMockChatCompletion("not json"));
    await expect(extractQuery("salmon")).resolves.toEqual({ q: "salmon" });
  });

  it("searches the raw text when the AI returns an empty q", async () => {
    aiReturns({ q: "   " });
    await expect(extractQuery("tofu stir fry")).resolves.toEqual({
      q: "tofu stir fry",
    });
  });
});

describe("rawQuery", () => {
  it("caps q at 200 chars and never returns an empty q", () => {
    expect(rawQuery("x".repeat(300)).q).toHaveLength(200);
    expect(rawQuery("   ").q).toBe("recipe");
  });
});
