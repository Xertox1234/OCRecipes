// Finder AI inputs with the REAL sanitisers (the per-module tests mock them
// as identities): user text must lose zero-width/bidi characters too.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { aiChat } from "../../../lib/ai-client";
import { createMockChatCompletion } from "../../../__tests__/factories";
import { askClarifying } from "../ask-clarifying";
import { classifyTurn } from "../classify-turn";
import { askDishFollowUps } from "../ask-follow-ups";

vi.mock("../../../lib/ai-client", () => ({ aiChat: vi.fn() }));
vi.mock("../../../lib/openai", () => ({ OPENAI_TIMEOUT_FAST_MS: 15_000 }));

const mockCreate = vi.mocked(aiChat);
const INVISIBLE = /[\u200B-\u200F\u2028-\u202F\uFEFF\u00AD]/;
const dirty = (word: string) =>
  `${word.slice(0, 2)}\u200B${word.slice(2)}\u202E\uFEFF`;
const userTurn = [{ role: "user" as const, content: dirty("lasagna") }];

beforeEach(() => {
  vi.clearAllMocks();
  mockCreate.mockResolvedValue(
    createMockChatCompletion(JSON.stringify({ questions: [], class: "other" })),
  );
});

function userPrompt(): string {
  const body = mockCreate.mock.calls[0][1] as {
    messages: { role: string; content: string }[];
  };
  return body.messages.filter((m) => m.role === "user").at(-1)!.content;
}

describe("finder user text loses zero-width/bidi characters", () => {
  it.each([
    [
      "askClarifying request + user turns",
      () => askClarifying(dirty("chicken"), userTurn),
      ["chicken", "User: lasagna"],
    ],
    [
      "classifyTurn message",
      () => classifyTurn(dirty("spicier"), "Chili"),
      ["spicier"],
    ],
    [
      "askDishFollowUps user turns",
      () =>
        askDishFollowUps(
          "Meatballs",
          { ingredients: [], fromConversation: false },
          userTurn,
        ),
      ["User: lasagna"],
    ],
  ] as const)("%s", async (_, run, expected) => {
    await run();
    const prompt = userPrompt();
    expect(prompt).not.toMatch(INVISIBLE);
    for (const text of expected) expect(prompt).toContain(text);
  });
});
