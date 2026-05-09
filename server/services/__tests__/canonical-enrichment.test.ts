import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateEditorialContent } from "../canonical-enrichment";

vi.mock("../../storage", () => ({
  storage: {
    getRecipeById: vi.fn(),
    markEnriched: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../lib/runware", () => ({
  isRunwareConfigured: false,
  generateImage: vi.fn().mockResolvedValue(null),
  saveImageBuffer: vi.fn().mockResolvedValue("/api/recipe-images/test.png"),
  RUNWARE_MODEL_HQ: "runware:101@1",
}));

// Hoist the mock fn so we can reference it in vi.mock factory and tests
const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("../../lib/openai", () => ({
  openai: {
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  },
  dalleClient: {
    images: {
      generate: vi.fn().mockResolvedValue({ data: [] }),
    },
  },
  MODEL_HEAVY: "gpt-4o",
  OPENAI_TIMEOUT_IMAGE_MS: 120000,
}));

vi.mock("../../lib/ai-safety", () => ({
  sanitizeUserInput: vi.fn((s: string) => s),
  SYSTEM_PROMPT_BOUNDARY: "SAFETY RULES",
}));

const defaultEditorialResponse = {
  choices: [
    {
      message: {
        content: JSON.stringify({
          instructionDetails: ["Detailed step 1"],
          toolsRequired: [{ name: "Skillet", affiliateUrl: null }],
          chefTips: ["Tip 1"],
          cuisineOrigin: "Italian",
        }),
      },
    },
  ],
};

describe("generateEditorialContent", () => {
  beforeEach(() => {
    mockCreate.mockResolvedValue(defaultEditorialResponse);
  });

  it("returns structured content from GPT-4o", async () => {
    const result = await generateEditorialContent({
      title: "Pasta Carbonara",
      ingredients: [{ name: "eggs", quantity: "3", unit: "large" }],
      instructions: ["Boil pasta"],
    });
    expect(result.instructionDetails).toHaveLength(1);
    expect(result.toolsRequired[0].name).toBe("Skillet");
    expect(result.cuisineOrigin).toBe("Italian");
  });

  it("returns fallback content if GPT-4o returns null content", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: null } }],
    });

    const result = await generateEditorialContent({
      title: "Test Recipe",
      ingredients: [],
      instructions: ["Step 1"],
    });
    // Should return fallback empty structure, not throw
    expect(Array.isArray(result.instructionDetails)).toBe(true);
    expect(Array.isArray(result.toolsRequired)).toBe(true);
    expect(Array.isArray(result.chefTips)).toBe(true);
  });

  it("returns fallback content if GPT-4o returns invalid JSON", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "not json at all" } }],
    });

    const result = await generateEditorialContent({
      title: "Test Recipe",
      ingredients: [],
      instructions: ["Step 1"],
    });
    expect(Array.isArray(result.instructionDetails)).toBe(true);
  });
});
