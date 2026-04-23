import { describe, it, expect, vi } from "vitest";
import {
  buildRecipeContext,
  checkRecipeAllergens,
  recipeChatMetadataSchema,
  RECIPE_SUGGESTION_CHIPS,
  generateRecipeChatResponse,
} from "../recipe-chat";
import type { ChatMessage } from "@shared/schema";

import { openai } from "../../lib/openai";
import { generateRecipeImage } from "../recipe-generation";

function createMessage(
  overrides: Partial<ChatMessage> & { role: string; content: string },
): ChatMessage {
  return {
    id: 1,
    conversationId: 1,
    metadata: null,
    createdAt: new Date(),
    ...overrides,
  } as ChatMessage;
}

describe("recipe-chat service", () => {
  describe("buildRecipeContext", () => {
    it("returns empty array for no messages", () => {
      const result = buildRecipeContext([]);
      expect(result).toEqual([]);
    });

    it("includes last N messages", () => {
      const messages = Array.from({ length: 15 }, (_, i) =>
        createMessage({
          id: i + 1,
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i + 1}`,
        }),
      );

      const result = buildRecipeContext(messages, 10);
      expect(result).toHaveLength(10);
      // Should include messages 6-15 (last 10)
      expect(result[0].content).toBe("Message 6");
      expect(result[9].content).toBe("Message 15");
    });

    it("includes full recipe JSON for the most recent recipe", () => {
      const recipe = {
        title: "Pasta",
        servings: 4,
        ingredients: [{ name: "pasta", quantity: "200", unit: "g" }],
        instructions: ["Boil water", "Cook pasta"],
        dietTags: ["vegetarian"],
      };

      const messages = [
        createMessage({ id: 1, role: "user", content: "Make pasta" }),
        createMessage({
          id: 2,
          role: "assistant",
          content: "Here's a recipe!",
          metadata: { recipe },
        }),
      ];

      const result = buildRecipeContext(messages);
      expect(result[1].content).toContain("[Recipe:");
      expect(result[1].content).toContain('"title":"Pasta"');
    });

    it("summarizes older recipes as title+servings only", () => {
      const recipe1 = {
        title: "Old Pasta",
        servings: 2,
        ingredients: [{ name: "pasta", quantity: "100", unit: "g" }],
        instructions: ["Cook"],
        dietTags: [],
      };
      const recipe2 = {
        title: "New Salad",
        servings: 4,
        ingredients: [{ name: "lettuce", quantity: "1", unit: "head" }],
        instructions: ["Wash", "Chop"],
        dietTags: ["vegan"],
      };

      const messages = [
        createMessage({
          id: 1,
          role: "assistant",
          content: "Here's pasta",
          metadata: { recipe: recipe1 },
        }),
        createMessage({ id: 2, role: "user", content: "Something healthier" }),
        createMessage({
          id: 3,
          role: "assistant",
          content: "Here's salad",
          metadata: { recipe: recipe2 },
        }),
      ];

      const result = buildRecipeContext(messages);
      // Most recent recipe (salad) has full JSON
      expect(result[2].content).toContain("[Recipe:");
      expect(result[2].content).toContain('"title":"New Salad"');
      // Older recipe (pasta) has summary only
      expect(result[0].content).toContain('[Previous recipe: "Old Pasta"');
      expect(result[0].content).not.toContain("ingredients");
    });
  });

  describe("checkRecipeAllergens", () => {
    it("returns null when user has no allergies", () => {
      const result = checkRecipeAllergens([{ name: "peanut butter" }], {
        allergies: [],
      } as any);
      expect(result).toBeNull();
    });

    it("returns null when no profile provided", () => {
      const result = checkRecipeAllergens([{ name: "chicken" }], null);
      expect(result).toBeNull();
    });

    it("detects allergens in ingredients", () => {
      const result = checkRecipeAllergens(
        [{ name: "peanut butter" }, { name: "bread" }],
        {
          allergies: [{ name: "Peanuts", severity: "severe" }],
        } as any,
      );
      expect(result).not.toBeNull();
      expect(result).toContain("Potential allergens detected");
    });

    it("returns null when no allergens match", () => {
      const result = checkRecipeAllergens(
        [{ name: "chicken" }, { name: "rice" }],
        {
          allergies: [{ name: "Peanuts", severity: "severe" }],
        } as any,
      );
      expect(result).toBeNull();
    });
  });

  describe("recipeChatMetadataSchema", () => {
    it("validates a correct metadata object", () => {
      const metadata = {
        metadataVersion: 1,
        recipe: {
          title: "Test Recipe",
          description: "A test",
          difficulty: "Easy",
          timeEstimate: "30 min",
          servings: 4,
          ingredients: [{ name: "chicken", quantity: "500", unit: "g" }],
          instructions: ["Cook the chicken"],
          dietTags: ["high-protein"],
        },
        allergenWarning: null,
        imageUrl: null,
      };

      const result = recipeChatMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(true);
    });

    it("rejects metadata with wrong version", () => {
      const metadata = {
        metadataVersion: 2,
        recipe: {
          title: "Test",
          description: "A test",
          difficulty: "Easy",
          timeEstimate: "30 min",
          servings: 4,
          ingredients: [{ name: "chicken", quantity: "500", unit: "g" }],
          instructions: ["Cook"],
          dietTags: [],
        },
        allergenWarning: null,
        imageUrl: null,
      };

      const result = recipeChatMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(false);
    });

    it("rejects metadata with missing recipe fields", () => {
      const metadata = {
        metadataVersion: 1,
        recipe: { title: "Test" },
        allergenWarning: null,
        imageUrl: null,
      };

      const result = recipeChatMetadataSchema.safeParse(metadata);
      expect(result.success).toBe(false);
    });
  });

  describe("RECIPE_SUGGESTION_CHIPS", () => {
    it("has at least 5 chips", () => {
      expect(RECIPE_SUGGESTION_CHIPS.length).toBeGreaterThanOrEqual(5);
    });

    it("each chip has label and prompt", () => {
      for (const chip of RECIPE_SUGGESTION_CHIPS) {
        expect(chip.label).toBeTruthy();
        expect(chip.prompt).toBeTruthy();
        expect(chip.prompt.length).toBeGreaterThan(10);
      }
    });
  });
});

vi.mock("../../lib/openai", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
  OPENAI_TIMEOUT_HEAVY_MS: 30_000,
  OPENAI_TIMEOUT_IMAGE_MS: 15_000,
  MODEL_HEAVY: "gpt-4o",
}));

vi.mock("../recipe-generation", () => ({
  generateRecipeImage: vi.fn(),
}));

vi.mock("../../lib/logger", () => ({
  createServiceLogger: () => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
  toError: (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
}));

vi.mock("../../lib/ai-safety", () => ({
  sanitizeUserInput: vi.fn((text: string) => text),
  SYSTEM_PROMPT_BOUNDARY: "---BOUNDARY---",
}));

vi.mock("../../lib/dietary-context", () => ({
  buildDietaryContext: vi.fn().mockReturnValue(""),
}));

describe("generateRecipeChatResponse — imageUnavailable on timeout", () => {
  it("yields imageUnavailable when image generation times out", async () => {
    // Build a minimal valid recipe JSON
    const recipeJson = JSON.stringify({
      title: "Test Recipe",
      description: "A test.",
      difficulty: "Easy" as const,
      timeEstimate: "10 min",
      servings: 2,
      ingredients: [{ name: "egg", quantity: "2", unit: "pcs" }],
      instructions: ["Boil the egg"],
      dietTags: [],
    });

    // Simulate streamed response with a valid recipe JSON
    const fakeChunks = [
      {
        choices: [
          {
            delta: { content: "Here you go!\n\n```json\n" },
            finish_reason: null,
          },
        ],
      },
      {
        choices: [{ delta: { content: recipeJson }, finish_reason: null }],
      },
      {
        choices: [{ delta: { content: "\n```" }, finish_reason: "stop" }],
      },
    ];

    vi.mocked(openai.chat.completions.create).mockResolvedValueOnce(
      (async function* () {
        for (const c of fakeChunks) yield c;
      })() as any,
    );

    // Image generation never resolves — simulates a timeout
    vi.mocked(generateRecipeImage).mockImplementation(
      () => new Promise(() => {}),
    );

    vi.useFakeTimers();
    const gen = generateRecipeChatResponse(
      [{ role: "user", content: "make me a recipe" }],
      null,
    );

    const events: unknown[] = [];
    const collectionPromise = (async () => {
      for await (const event of gen) {
        events.push(event);
      }
    })();

    await vi.runAllTimersAsync();
    await collectionPromise;
    vi.useRealTimers();

    const unavailableEvent = events.find(
      (e) => typeof e === "object" && e !== null && "imageUnavailable" in e,
    );
    expect(unavailableEvent).toEqual({ content: "", imageUnavailable: true });
  });

  it("yields imageUnavailable when image generation throws", async () => {
    const { generateRecipeChatResponse } = await import("../recipe-chat");
    const { openai } = await import("../../lib/openai");
    const { generateRecipeImage } = await import("../recipe-generation");

    const recipeJson = JSON.stringify({
      title: "Test Recipe",
      description: "A test.",
      difficulty: "Easy" as const,
      timeEstimate: "10 min",
      servings: 2,
      ingredients: [{ name: "egg", quantity: "2", unit: "pcs" }],
      instructions: ["Boil the egg"],
      dietTags: [],
    });

    const fakeChunks = [
      {
        choices: [
          {
            delta: { content: "Here you go!\n\n```json\n" },
            finish_reason: null,
          },
        ],
      },
      { choices: [{ delta: { content: recipeJson }, finish_reason: null }] },
      { choices: [{ delta: { content: "\n```" }, finish_reason: "stop" }] },
    ];

    vi.mocked(openai.chat.completions.create).mockResolvedValueOnce(
      (async function* () {
        for (const c of fakeChunks) yield c;
      })() as any,
    );

    vi.mocked(generateRecipeImage).mockRejectedValueOnce(
      new Error("network failure"),
    );

    const events: unknown[] = [];
    const gen = generateRecipeChatResponse(
      [{ role: "user", content: "make me a recipe" }],
      null,
    );
    for await (const event of gen) {
      events.push(event);
    }

    const unavailableEvent = events.find(
      (e) => typeof e === "object" && e !== null && "imageUnavailable" in e,
    );
    expect(unavailableEvent).toEqual({ content: "", imageUnavailable: true });
  });
});
