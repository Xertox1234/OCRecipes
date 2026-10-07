import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatMessage } from "@shared/schema";
import { extractQuery, rawQuery, extractOfferDetails } from "../extract-query";
import {
  sanitizeContextField,
  sanitizeUserInput,
} from "../../../lib/ai-safety";
import { aiChat } from "../../../lib/ai-client";
import { createMockChatCompletion } from "../../../__tests__/factories";

vi.mock("../../../lib/ai-client", () => ({ aiChat: vi.fn() }));
vi.mock("../../../lib/openai", () => ({
  OPENAI_TIMEOUT_FAST_MS: 15_000,
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

const mockCreate = vi.mocked(aiChat);

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
    expect(mockCreate.mock.calls[0][0]).toBe("finder-extract-query");
    const call = mockCreate.mock.calls[0][1] as {
      response_format: unknown;
    };
    expect(call.response_format).toEqual({ type: "json_object" });
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

describe("extractOfferDetails", () => {
  it("maps dish + servings 8 and validates each field", async () => {
    aiReturns({
      dish: "Spaghetti and meatballs",
      servings: 8,
      spice: null,
      time: null,
      ingredients: [],
    });
    await expect(
      extractOfferDetails("make spaghetti and meatballs for 8", []),
    ).resolves.toEqual({
      dish: "Spaghetti and meatballs",
      details: { servings: 8, ingredients: [], fromConversation: false },
    });
    expect(mockCreate.mock.calls[0][0]).toBe("finder-extract-offer");
  });

  it("drops servings 99 but keeps the dish", async () => {
    aiReturns({ dish: "Chili", servings: 99, ingredients: [] });
    const out = await extractOfferDetails("chili for 99", []);
    expect(out.dish).toBe("Chili");
    expect(out.details.servings).toBeUndefined();
  });

  it("returns dish null when the AI call throws", async () => {
    mockCreate.mockRejectedValue(new Error("boom"));
    await expect(extractOfferDetails("chili", [])).resolves.toEqual({
      dish: null,
      details: { ingredients: [], fromConversation: false },
    });
  });

  it("rejects an over-long dish (null, not truncated)", async () => {
    aiReturns({ dish: "x".repeat(81), ingredients: [] });
    const out = await extractOfferDetails("make it", []);
    expect(out.dish).toBeNull();
  });

  it("cleans control/zero-width chars with the real sanitiser", async () => {
    const actual = await vi.importActual<
      typeof import("../../../lib/ai-safety")
    >("../../../lib/ai-safety");
    vi.mocked(sanitizeContextField).mockImplementation(
      actual.sanitizeContextField,
    );
    const raw = "Chi\u200Bli\u0000 con carne";
    const expected = actual.sanitizeContextField(raw, 81).trim();
    aiReturns({ dish: raw, ingredients: [] });
    const out = await extractOfferDetails("chili", []);
    expect(out.dish).toBe(expected || null);
    expect(out.dish ?? "").not.toMatch(/[\u200B\u0000]/);
  });

  it("sends only the last 6 history turns, sanitising history and text", async () => {
    const history = Array.from({ length: 8 }, (_, i) => ({
      id: i,
      conversationId: 1,
      role: i % 2 ? "assistant" : "user",
      content: `turn-${i}`,
      metadata: null,
      turnKey: null,
      createdAt: new Date(),
    })) as ChatMessage[];
    aiReturns({ dish: "Chili", ingredients: [] });
    await extractOfferDetails("latest-text", history);
    const call = mockCreate.mock.calls[0][1] as {
      messages: { role: string; content: string }[];
    };
    const prompt = call.messages[1].content;
    expect(prompt).not.toContain("turn-0");
    expect(prompt).not.toContain("turn-1");
    for (const i of [2, 3, 4, 5, 6, 7]) expect(prompt).toContain(`turn-${i}`);
    expect(vi.mocked(sanitizeUserInput)).toHaveBeenCalledWith("latest-text");
    expect(vi.mocked(sanitizeUserInput)).toHaveBeenCalledWith("turn-6");
    expect(vi.mocked(sanitizeContextField)).toHaveBeenCalledWith("turn-7", 300);
  });
});
