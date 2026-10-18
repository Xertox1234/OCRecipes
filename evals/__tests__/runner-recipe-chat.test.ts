import { describe, it, expect, vi } from "vitest";
import type { EvalTestCase } from "../types";

// The recipe-chat runner must stop consuming the service stream once the
// recipe card has arrived: everything after it is the hero-image step
// (Runware, up to a 15 s race), which the judge never sees and which would
// otherwise land in every sample's latencyMs and write an image per sample.

const state = vi.hoisted(() => ({
  captured: null as null | {
    generateResponse: (tc: EvalTestCase) => Promise<{ text: string }>;
  },
  imageStepReached: false,
}));

vi.mock("dotenv/config", () => ({}));

vi.mock("../lib/runner-core", () => ({
  runEvalSuite: vi.fn(async (_cases: unknown, config: unknown) => {
    state.captured = config as typeof state.captured;
  }),
}));

vi.mock("../../server/services/recipe-chat", () => ({
  generateRecipeChatResponse: async function* () {
    yield { content: "Since you can't have peanuts, here's a quick idea.\n" };
    yield { content: '```json\n{"title": "Lemon Chicken"}\n```' };
    yield {
      content: "",
      recipe: {
        title: "Lemon Chicken",
        description: "Bright and fast.",
        ingredients: [{ name: "chicken", quantity: "2", unit: "breasts" }],
        instructions: ["Cook it."],
        dietTags: [],
      },
      allergenWarning: null,
    };
    // In the real service the hero-image generation starts here.
    state.imageStepReached = true;
    yield { content: "", imageUnavailable: true };
    yield { done: true };
  },
}));

describe("recipe-chat eval runner", () => {
  it("stops consuming the stream once the recipe card has arrived", async () => {
    await import("../runner-recipe-chat");
    expect(state.captured).not.toBeNull();

    const result = await state.captured!.generateResponse({
      id: "x",
      category: "helpfulness",
      description: "",
      input: {
        userMessage: "dinner?",
        userProfile: null,
        conversationHistory: [],
      },
      scoreDimensions: ["relevance"],
    } as unknown as EvalTestCase);

    // The conversational text is where an allergen callout lives: keep it
    // ahead of the card, without the raw JSON fence the service streamed.
    expect(result.text.startsWith("Since you can't have peanuts")).toBe(true);
    expect(result.text).not.toContain("```json");
    expect(result.text).toContain("Recipe: Lemon Chicken");
    expect(result.text).toContain("- 2 breasts chicken");
    expect(state.imageStepReached).toBe(false);
  });
});
