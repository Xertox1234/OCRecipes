import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateEditorialContent,
  enrichRecipe,
} from "../canonical-enrichment";
import { storage } from "../../storage";
import { createMockCommunityRecipe } from "../../__tests__/factories";

vi.mock("../../storage", () => ({
  storage: {
    getRecipeById: vi.fn(),
    markEnriched: vi.fn().mockResolvedValue(undefined),
  },
}));

// Hoisted, mutable image-pipeline knobs so individual tests can flip the
// Runware-configured flag and choose Runware success vs failure.
const runware = vi.hoisted(() => ({
  configured: false,
  generateImage: vi.fn().mockResolvedValue(null as Buffer | null),
  saveImageBuffer: vi.fn().mockResolvedValue("/api/recipe-images/test.png"),
}));

vi.mock("../../lib/runware", () => ({
  // Getter so the source's `import { isRunwareConfigured }` binding re-reads the
  // mutable value on every access.
  get isRunwareConfigured() {
    return runware.configured;
  },
  generateImage: runware.generateImage,
  saveImageBuffer: runware.saveImageBuffer,
  RUNWARE_MODEL_HQ: "runware:101@1",
}));

// Hoist the mock fn so we can reference it in vi.mock factory and tests
const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("../../lib/ai-client", () => ({ aiChat: mockCreate }));
vi.mock("../../lib/openai", () => ({
  OPENAI_TIMEOUT_LONG_MS: 120000,
  OPENAI_TIMEOUT_FAST_MS: 30000,
  // isAiConfigured: false keeps buildImagePrompt in deterministic mode
  // (skips the LLM art-director pre-pass so prompt assertions are stable)
  isAiConfigured: false,
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
    expect(mockCreate.mock.calls[0][0]).toBe("canonical-editorial");
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

  it("returns fallback when the response fails schema validation", async () => {
    // chefTips is required as string[]; a number array fails the schema.
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              instructionDetails: [],
              toolsRequired: [],
              chefTips: [123],
              cuisineOrigin: "French",
            }),
          },
        },
      ],
    });

    const result = await generateEditorialContent({
      title: "Test Recipe",
      ingredients: [],
      instructions: ["Step 1"],
    });
    expect(result.cuisineOrigin).toBe("");
    expect(result.chefTips).toEqual([]);
  });

  it("returns fallback when the OpenAI call throws", async () => {
    mockCreate.mockRejectedValueOnce(new Error("openai down"));

    const result = await generateEditorialContent({
      title: "Test Recipe",
      ingredients: [],
      instructions: ["Step 1"],
    });
    expect(result).toEqual({
      instructionDetails: [],
      toolsRequired: [],
      chefTips: [],
      cuisineOrigin: "",
    });
  });

  it("pads instructionDetails to match instruction count and maps tools", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              instructionDetails: ["only one detail"],
              toolsRequired: [{ name: "Whisk" }],
              chefTips: ["Tip"],
              cuisineOrigin: "Thai",
            }),
          },
        },
      ],
    });

    const result = await generateEditorialContent({
      title: "Curry",
      ingredients: [],
      instructions: ["Step 1", "Step 2", "Step 3"],
    });
    // Padded to 3 (one detail + two nulls).
    expect(result.instructionDetails).toEqual(["only one detail", null, null]);
    expect(result.toolsRequired[0]).toEqual({
      name: "Whisk",
      affiliateUrl: undefined,
    });
  });

  // The prompt asks for null, but nothing enforced it: a steered model could
  // put a phishing link on a canonical recipe that every viewer can tap
  // (audit 2026-10-29 L-sec-8). No affiliate program exists, so none is kept.
  it("never stores a model-supplied affiliate URL", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              instructionDetails: [],
              toolsRequired: [
                { name: "Skillet", affiliateUrl: "https://evil.example/login" },
                { name: "Knife", affiliateUrl: "javascript:alert(1)" },
              ],
              chefTips: [],
              cuisineOrigin: "",
            }),
          },
        },
      ],
    });

    const result = await generateEditorialContent({
      title: "Hash",
      ingredients: [],
      instructions: [],
    });

    expect(result.toolsRequired).toEqual([
      { name: "Skillet", affiliateUrl: undefined },
      { name: "Knife", affiliateUrl: undefined },
    ]);
  });
});

describe("enrichRecipe", () => {
  beforeEach(() => {
    mockCreate.mockResolvedValue(defaultEditorialResponse);
    runware.configured = false;
    runware.generateImage.mockResolvedValue(null);
    runware.saveImageBuffer.mockResolvedValue("/api/recipe-images/test.png");
  });

  it("throws when the recipe is not found", async () => {
    vi.mocked(storage.getRecipeById).mockResolvedValue(null);
    await expect(enrichRecipe(123)).rejects.toThrow("Recipe 123 not found");
    expect(storage.markEnriched).not.toHaveBeenCalled();
  });

  it("skips re-enrichment when the recipe is already enriched", async () => {
    vi.mocked(storage.getRecipeById).mockResolvedValue(
      createMockCommunityRecipe({
        id: 5,
        canonicalEnrichedAt: new Date("2024-02-01"),
      }),
    );
    await enrichRecipe(5);
    expect(storage.markEnriched).not.toHaveBeenCalled();
  });

  it("enriches via Runware and normalizes ingredients/instructions", async () => {
    runware.configured = true;
    runware.generateImage.mockResolvedValue(Buffer.from("img"));
    vi.mocked(storage.getRecipeById).mockResolvedValue(
      createMockCommunityRecipe({
        id: 5,
        title: "Test Dish",
        canonicalEnrichedAt: null,
        ingredients: [
          { name: "flour", quantity: "2", unit: "tbsp" },
        ] as unknown as ReturnType<
          typeof createMockCommunityRecipe
        >["ingredients"],
        instructions: ["mix it well", "bake until golden"],
      }),
    );

    await enrichRecipe(5);

    expect(storage.markEnriched).toHaveBeenCalledTimes(1);
    const [recipeId, enrichment] = vi.mocked(storage.markEnriched).mock
      .calls[0];
    expect(recipeId).toBe(5);
    // 3 image shots all succeed via Runware.
    expect(enrichment.canonicalImages).toHaveLength(3);
    // Editorial content from the default GPT-4o mock.
    expect(enrichment.cuisineOrigin).toBe("Italian");
    expect(enrichment.toolsRequired[0].name).toBe("Skillet");
  });

  it("uses the Runware HQ path when configured", async () => {
    runware.configured = true;
    runware.generateImage.mockResolvedValue(Buffer.from("runware-img"));
    runware.saveImageBuffer.mockResolvedValue("/api/recipe-images/hq.png");
    vi.mocked(storage.getRecipeById).mockResolvedValue(
      createMockCommunityRecipe({
        id: 9,
        title: "HQ Dish",
        canonicalEnrichedAt: null,
        ingredients: [] as unknown as ReturnType<
          typeof createMockCommunityRecipe
        >["ingredients"],
        instructions: ["step one"],
      }),
    );

    await enrichRecipe(9);

    expect(runware.generateImage).toHaveBeenCalled();
    const [, enrichment] = vi.mocked(storage.markEnriched).mock.calls[0];
    expect(enrichment.canonicalImages).toHaveLength(3);
    // Verify positive-only prompt: editorial phrase present, no negative terms
    // (exclusions travel in Runware's negativePrompt field only)
    const firstCall = runware.generateImage.mock.calls[0][0] as {
      prompt: string;
    };
    expect(firstCall.prompt).toMatch(/editorial food photography/i);
    expect(firstCall.prompt).not.toMatch(/no text|watermark/i);
    // Runware bytes are JPEG (no outputFormat requested) — every saved shot
    // must be labelled to match, not left at saveImageBuffer's "png" default.
    expect(runware.saveImageBuffer).toHaveBeenCalledWith(
      expect.any(Buffer),
      "jpg",
    );
  });

  it("skips images when Runware throws", async () => {
    runware.configured = true;
    runware.generateImage.mockRejectedValue(new Error("runware boom"));
    vi.mocked(storage.getRecipeById).mockResolvedValue(
      createMockCommunityRecipe({
        id: 11,
        title: "No Image Dish",
        canonicalEnrichedAt: null,
        ingredients: [] as unknown as ReturnType<
          typeof createMockCommunityRecipe
        >["ingredients"],
        instructions: [],
      }),
    );

    await enrichRecipe(11);

    const [, enrichment] = vi.mocked(storage.markEnriched).mock.calls[0];
    expect(enrichment.canonicalImages).toEqual([]);
  });

  it("skips images when Runware returns no image", async () => {
    runware.configured = true;
    runware.generateImage.mockResolvedValue(null);
    vi.mocked(storage.getRecipeById).mockResolvedValue(
      createMockCommunityRecipe({
        id: 12,
        title: "Empty Image Dish",
        canonicalEnrichedAt: null,
        ingredients: [] as unknown as ReturnType<
          typeof createMockCommunityRecipe
        >["ingredients"],
        instructions: [],
      }),
    );

    await enrichRecipe(12);

    const [, enrichment] = vi.mocked(storage.markEnriched).mock.calls[0];
    expect(enrichment.canonicalImages).toEqual([]);
  });

  it("generates no images when Runware is not configured", async () => {
    vi.mocked(storage.getRecipeById).mockResolvedValue(
      createMockCommunityRecipe({
        id: 13,
        title: "Unconfigured Dish",
        canonicalEnrichedAt: null,
        ingredients: [] as unknown as ReturnType<
          typeof createMockCommunityRecipe
        >["ingredients"],
        instructions: [],
      }),
    );

    await enrichRecipe(13);

    expect(runware.generateImage).not.toHaveBeenCalled();
    const [, enrichment] = vi.mocked(storage.markEnriched).mock.calls[0];
    expect(enrichment.canonicalImages).toEqual([]);
  });
});
