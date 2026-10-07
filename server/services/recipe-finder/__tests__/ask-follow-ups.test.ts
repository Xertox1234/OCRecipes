import { describe, it, expect, vi, beforeEach } from "vitest";
import { askDishFollowUps } from "../ask-follow-ups";
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
