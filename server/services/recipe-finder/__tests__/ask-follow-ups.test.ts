import { describe, it, expect, vi, beforeEach } from "vitest";
import { askDishFollowUps } from "../ask-follow-ups";
import { aiChat } from "../../../lib/ai-client";
import { sanitizeContextField } from "../../../lib/ai-safety";
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
const details = { ingredients: ["beef"], fromConversation: true };
const q = (question: string) => ({ question, options: ["a", "b"] });

beforeEach(() => vi.clearAllMocks());

describe("askDishFollowUps", () => {
  it("returns the AI's questions and uses the feature key", async () => {
    const questions = [q("Beef or pork?")];
    mockCreate.mockResolvedValue(
      createMockChatCompletion(JSON.stringify({ questions })),
    );
    await expect(askDishFollowUps("Meatballs", details, [])).resolves.toEqual(
      questions,
    );
    expect(mockCreate.mock.calls[0][0]).toBe("finder-dish-follow-ups");
  });

  it("returns [] when aiChat throws", async () => {
    mockCreate.mockRejectedValue(new Error("timeout"));
    await expect(askDishFollowUps("Meatballs", details, [])).resolves.toEqual(
      [],
    );
  });

  it("returns [] on invalid JSON", async () => {
    mockCreate.mockResolvedValue(createMockChatCompletion("nope"));
    await expect(askDishFollowUps("Meatballs", details, [])).resolves.toEqual(
      [],
    );
  });

  it("truncates to 2 questions", async () => {
    const questions = [q("Beef or pork?"), q("Baked or fried?"), q("Sauce?")];
    mockCreate.mockResolvedValue(
      createMockChatCompletion(JSON.stringify({ questions })),
    );
    const out = await askDishFollowUps("Meatballs", details, []);
    expect(out).toEqual(questions.slice(0, 2));
  });

  it("keeps the dish out of the system prompt and in the user message", async () => {
    mockCreate.mockResolvedValue(
      createMockChatCompletion(JSON.stringify({ questions: [] })),
    );
    await askDishFollowUps('Meatballs" injected', details, []);
    const messages = mockCreate.mock.calls[0][1].messages;
    expect(messages[0].content).not.toContain("Meatballs");
    expect(messages[1].content).toContain("Meatballs");
  });

  it("uses word boundaries: keeps 'Serve with...' and drops 'how much time'", async () => {
    const keep = q("Serve with rice or noodles?");
    mockCreate.mockResolvedValue(
      createMockChatCompletion(
        JSON.stringify({ questions: [q("How much time do you have?"), keep] }),
      ),
    );
    await expect(askDishFollowUps("Meatballs", details, [])).resolves.toEqual([
      keep,
    ]);
  });

  it("keeps the valid questions when one in the batch is invalid", async () => {
    const keep = q("Beef or pork?");
    mockCreate.mockResolvedValue(
      createMockChatCompletion(
        JSON.stringify({
          questions: [{ question: "Sauce?", options: ["only one"] }, keep],
        }),
      ),
    );
    await expect(askDishFollowUps("Meatballs", details, [])).resolves.toEqual([
      keep,
    ]);
  });

  it("drops a repeated question (the server accepts one answer per question)", async () => {
    const beef = q("Beef or pork?");
    const sauce = q("Red or white sauce?");
    mockCreate.mockResolvedValue(
      createMockChatCompletion(
        JSON.stringify({ questions: [beef, beef, sauce] }),
      ),
    );
    await expect(askDishFollowUps("Meatballs", details, [])).resolves.toEqual([
      beef,
      sauce,
    ]);
  });

  it("puts the dish, transcript and ingredients through the sanitiser", async () => {
    vi.mocked(sanitizeContextField).mockImplementation(
      (t: string) => `ctx(${t})`,
    );
    try {
      mockCreate.mockResolvedValue(
        createMockChatCompletion(JSON.stringify({ questions: [] })),
      );
      await askDishFollowUps("Meatballs", details, [
        { role: "user", content: "make meatballs" },
        { role: "assistant", content: "Sure thing" },
      ]);
      expect(sanitizeContextField).toHaveBeenCalledWith("Meatballs", 80);
      expect(sanitizeContextField).toHaveBeenCalledWith("make meatballs", 300);
      expect(sanitizeContextField).toHaveBeenCalledWith("Sure thing", 300);
      expect(sanitizeContextField).toHaveBeenCalledWith("beef", 60);
      // The prompt carries the sanitiser's OUTPUT, not the raw text.
      const prompt = mockCreate.mock.calls[0][1].messages[1].content;
      expect(prompt).toContain("Dish: ctx(Meatballs)");
      expect(prompt).toContain("User: ctx(make meatballs)");
      expect(prompt).toContain("Assistant: ctx(Sure thing)");
      expect(prompt).toContain("Ingredients mentioned: ctx(beef)");
    } finally {
      vi.mocked(sanitizeContextField).mockImplementation((t: string) => t);
    }
  });

  it("drops questions about allergies, servings, spice or time", async () => {
    const questions = [
      q("Any allergies?"),
      q("How many servings?"),
      q("How spicy?"),
      q("Beef or pork?"),
    ];
    mockCreate.mockResolvedValue(
      createMockChatCompletion(JSON.stringify({ questions })),
    );
    await expect(askDishFollowUps("Meatballs", details, [])).resolves.toEqual([
      q("Beef or pork?"),
    ]);
  });
});
