import {
  normalizeProductName,
  generateRecipeContent,
  generateRecipeImage,
  generateFullRecipe,
  generateAndPatchRecipeImage,
} from "../recipe-generation";

import { aiChat } from "../../lib/ai-client";

// Mock fs to avoid writing to disk in tests
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    default: {
      ...actual,
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
      existsSync: vi.fn(() => true),
      promises: {
        ...actual.promises,
        writeFile: vi.fn().mockResolvedValue(undefined),
      },
    },
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn(() => true),
    promises: {
      ...actual.promises,
      writeFile: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// Mock the openai module
vi.mock("../../lib/ai-client", () => ({ aiChat: vi.fn() }));
vi.mock("../../lib/openai", () => ({
  OPENAI_TIMEOUT_HEAVY_MS: 60_000,
  OPENAI_TIMEOUT_IMAGE_MS: 120_000,
  OPENAI_TIMEOUT_FAST_MS: 30_000,
  // isAiConfigured: false keeps isArtDirectorLLMEnabled() → false,
  // so image-art-direction uses the deterministic path (no LLM calls in tests).
  isAiConfigured: false,
}));

// Mock storage for generateAndPatchRecipeImage
const mockUpdateCommunityRecipeImageUrl = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
vi.mock("../../storage/index", () => ({
  storage: {
    updateCommunityRecipeImageUrl: mockUpdateCommunityRecipeImageUrl,
  },
}));

// Mock the runware module — isRunwareConfigured is controlled via a mutable ref
const runwareMock = vi.hoisted(() => ({
  isRunwareConfigured: false,
  generateImage: vi.fn(),
}));
vi.mock("../../lib/runware", () => runwareMock);

const mockCreate = vi.mocked(aiChat);
const mockRunwareGenerate = runwareMock.generateImage;

describe("Recipe Generation", () => {
  describe("normalizeProductName", () => {
    it("lowercases the name", () => {
      expect(normalizeProductName("Chicken Breast")).toBe("chicken breast");
    });

    it("trims whitespace", () => {
      expect(normalizeProductName("  salmon  ")).toBe("salmon");
    });

    it("removes special characters", () => {
      expect(normalizeProductName("Ben & Jerry's")).toBe("ben jerrys");
    });

    it("collapses multiple spaces", () => {
      expect(normalizeProductName("brown   rice")).toBe("brown rice");
    });

    it("handles empty string", () => {
      expect(normalizeProductName("")).toBe("");
    });

    it("handles string with only special chars", () => {
      expect(normalizeProductName("@#$%")).toBe("");
    });

    it("preserves numbers", () => {
      expect(normalizeProductName("100% Whole Wheat")).toBe("100 whole wheat");
    });

    it("handles accented characters (keeps letters)", () => {
      const result = normalizeProductName("Crème Brûlée");
      // \w in JS doesn't match accented chars, so they get stripped
      expect(result).toBe("crme brle");
    });
  });

  describe("generateRecipeContent", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("returns validated recipe content from OpenAI response", async () => {
      const mockRecipe = {
        title: "Grilled Chicken Salad",
        description: "A light and healthy salad.",
        difficulty: "Easy",
        timeEstimate: "20 min",
        ingredients: [
          { name: "chicken breast", quantity: "2", unit: "" },
          { name: "mixed greens", quantity: "4", unit: "cups" },
        ],
        instructions: "Grill chicken\nToss salad\nCombine",
        dietTags: ["high-protein", "low-carb"],
      };

      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockRecipe) } }],
      } as any);

      const result = await generateRecipeContent({
        productName: "Chicken Breast",
      });

      expect(result.title).toBe("Grilled Chicken Salad");
      expect(result.description).toBe("A light and healthy salad.");
      expect(result.difficulty).toBe("Easy");
      expect(result.timeEstimate).toBe("20 min");
      expect(result.ingredients).toHaveLength(2);
      expect(result.ingredients[0].name).toBe("chicken breast");
      expect(result.instructions).toContain("Grill chicken");
      expect(result.instructions).toContain("Toss salad");
      expect(result.dietTags).toEqual(["high-protein", "low-carb"]);
      expect(mockCreate.mock.calls[0][0]).toBe("recipe-generate");
    });

    // Gemini 4 Argon (spec 2026-10-17 §3): a full recipe is ~900 output
    // tokens and the old 2000 cap left no room for a model that reasons;
    // the cap is free when unused.
    it("sends a 4000-token output cap", async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: JSON.stringify({
                title: "Grilled Chicken Salad",
                description: "A light and healthy salad.",
                difficulty: "Easy",
                timeEstimate: "20 min",
                ingredients: [
                  { name: "chicken breast", quantity: "2", unit: "" },
                ],
                instructions: "Grill chicken",
                dietTags: [],
              }),
            },
          },
        ],
      } as any);

      await generateRecipeContent({ productName: "Chicken Breast" });

      expect(mockCreate.mock.calls[0][1]).toEqual(
        expect.objectContaining({ max_completion_tokens: 4000 }),
      );
    });

    describe("spiceLevel", () => {
      const base = {
        title: "Chili",
        description: "Warm.",
        difficulty: "Easy",
        timeEstimate: "30 min",
        ingredients: [{ name: "cayenne", quantity: "1", unit: "tsp" }],
        instructions: ["Cook"],
        dietTags: [],
      };
      const run = async (extra: Record<string, unknown>) => {
        mockCreate.mockResolvedValue({
          choices: [
            { message: { content: JSON.stringify({ ...base, ...extra }) } },
          ],
        } as any);
        return generateRecipeContent({ productName: "Chili" });
      };

      it.each(["mild", "medium", "hot"])(
        "keeps a valid %s level",
        async (l) => {
          expect((await run({ spiceLevel: l })).spiceLevel).toBe(l);
        },
      );

      it("turns missing, null and invalid values into null without rejecting the recipe", async () => {
        for (const extra of [
          {},
          { spiceLevel: null },
          { spiceLevel: "volcanic" },
          { spiceLevel: 3 },
        ]) {
          const result = await run(extra);
          expect(result.title).toBe("Chili");
          expect(result.spiceLevel).toBeNull();
        }
      });

      it("asks the AI for spiceLevel in the prompt schema", async () => {
        await run({});
        const system = JSON.stringify(mockCreate.mock.calls.at(-1)?.[1]);
        expect(system).toContain("spiceLevel");
      });
    });

    it("handles instructions as array of strings", async () => {
      const mockRecipe = {
        title: "Simple Rice",
        description: "Easy rice dish",
        difficulty: "Easy",
        timeEstimate: "15 min",
        ingredients: [{ name: "rice", quantity: "1", unit: "cup" }],
        instructions: ["Boil water", "Add rice", "Simmer for 12 minutes"],
        dietTags: ["vegan"],
      };

      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockRecipe) } }],
      } as any);

      const result = await generateRecipeContent({ productName: "Rice" });

      expect(result.instructions).toContain("Boil water");
      expect(result.instructions).toContain("Add rice");
    });

    it("handles instructions as array of objects", async () => {
      const mockRecipe = {
        title: "Simple Rice",
        description: "Easy rice dish",
        difficulty: "Easy",
        timeEstimate: "15 min",
        ingredients: [{ name: "rice", quantity: "1", unit: "cup" }],
        instructions: [
          { step: 1, text: "Boil water" },
          { step: 2, text: "Add rice" },
        ],
        dietTags: [],
      };

      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockRecipe) } }],
      } as any);

      const result = await generateRecipeContent({ productName: "Rice" });

      expect(result.instructions).toContain("Boil water");
      expect(result.instructions).toContain("Add rice");
    });

    it("throws user-friendly error on OpenAI API failure", async () => {
      mockCreate.mockRejectedValue(new Error("API timeout"));

      await expect(
        generateRecipeContent({ productName: "Chicken" }),
      ).rejects.toThrow("Failed to generate recipe. Please try again.");
    });

    it("throws on invalid recipe content from OpenAI", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ title: "" }) } }],
      } as any);

      await expect(
        generateRecipeContent({ productName: "Fish" }),
      ).rejects.toThrow("Failed to generate valid recipe content");
    });

    it("throws on empty response from OpenAI", async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
      } as any);

      await expect(
        generateRecipeContent({ productName: "Eggs" }),
      ).rejects.toThrow();
    });

    it("extracts ingredients from instructions when AI returns both markers", async () => {
      const mockRecipe = {
        title: "Pad Thai",
        description: "Classic Thai noodle dish.",
        difficulty: "Medium",
        timeEstimate: "30 min",
        ingredients: [],
        instructions: [
          "Ingredients:",
          "200g rice noodles",
          "300g chicken thighs",
          "3 tbsp fish sauce",
          "Instructions:",
          "Mix fish sauce with garlic",
          "Cook chicken until golden",
        ],
        dietTags: [],
      };

      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockRecipe) } }],
      } as any);

      const result = await generateRecipeContent({
        productName: "Rice noodles",
      });

      expect(result.ingredients).toHaveLength(3);
      expect(result.ingredients[0]).toMatchObject({
        name: "rice noodles",
        quantity: "200",
        unit: "g",
      });
      expect(result.ingredients[1]).toMatchObject({
        name: "chicken thighs",
        quantity: "300",
        unit: "g",
      });
      expect(result.ingredients[2]).toMatchObject({
        name: "fish sauce",
        quantity: "3",
        unit: "tbsp",
      });
      expect(result.instructions).toHaveLength(2);
      expect(result.instructions[0]).toBe("Mix fish sauce with garlic");
      expect(result.instructions[1]).toBe("Cook chicken until golden");
    });

    it("extracts ingredients when only Ingredients: marker is present", async () => {
      const mockRecipe = {
        title: "Simple Salad",
        description: "A fresh salad.",
        difficulty: "Easy",
        timeEstimate: "10 min",
        ingredients: [],
        instructions: [
          "Ingredients:",
          "2 cucumbers",
          "1 tomato",
          "Toss everything together in a bowl",
          "Season with salt and pepper",
          "Serve immediately",
        ],
        dietTags: ["vegan"],
      };

      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockRecipe) } }],
      } as any);

      const result = await generateRecipeContent({ productName: "Cucumber" });

      expect(result.ingredients).toHaveLength(2);
      expect(result.ingredients[0]).toMatchObject({
        name: "cucumbers",
        quantity: "2",
      });
      expect(result.ingredients[1]).toMatchObject({
        name: "tomato",
        quantity: "1",
      });
      expect(result.instructions).toHaveLength(3);
      expect(result.instructions[0]).toBe("Toss everything together in a bowl");
    });

    it("handles Instructions: marker embedded in last ingredient line via newline", async () => {
      const mockRecipe = {
        title: "Noodle Soup",
        description: "Warm noodle soup.",
        difficulty: "Easy",
        timeEstimate: "20 min",
        ingredients: [],
        instructions: [
          "Ingredients:",
          "200g rice noodles",
          "Optional: sliced red chili for garnish\n\nInstructions:",
          "Boil water and cook noodles",
          "Serve hot",
        ],
        dietTags: [],
      };

      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(mockRecipe) } }],
      } as any);

      const result = await generateRecipeContent({
        productName: "Rice noodles",
      });

      expect(result.ingredients).toHaveLength(2);
      expect(result.ingredients[1]).toMatchObject({
        name: "Optional: sliced red chili for garnish",
      });
      expect(result.instructions).toHaveLength(2);
      expect(result.instructions[0]).toBe("Boil water and cook noodles");
    });

    it("passes dietary context from user profile", async () => {
      const validRecipe = {
        title: "Vegan Bowl",
        description: "Plant-based bowl",
        difficulty: "Easy",
        timeEstimate: "15 min",
        ingredients: [{ name: "tofu", quantity: "200", unit: "g" }],
        instructions: "Mix ingredients together",
        dietTags: ["vegan"],
      };

      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(validRecipe) } }],
      } as any);

      await generateRecipeContent({
        productName: "Tofu",
        userProfile: {
          allergies: [{ name: "Peanuts", severity: "severe" }],
          dietType: "vegan",
          cookingSkillLevel: "beginner",
          cookingTimeAvailable: "15 minutes",
        } as any,
        dietPreferences: ["gluten-free"],
      });

      const prompt = mockCreate.mock.calls[0][1].messages[1].content as string;
      expect(prompt).toContain("Peanuts");
      expect(prompt).toContain("vegan");
      expect(prompt).toContain("gluten-free");
    });
  });

  describe("generateRecipeImage", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("returns null without calling Runware when it is not configured", async () => {
      const result = await generateRecipeImage({
        title: "Chicken Salad",
        productName: "Chicken",
      });

      expect(result).toBeNull();
      expect(mockRunwareGenerate).not.toHaveBeenCalled();
    });

    describe("with Runware configured", () => {
      beforeEach(() => {
        runwareMock.isRunwareConfigured = true;
      });

      afterEach(() => {
        runwareMock.isRunwareConfigured = false;
      });

      it("uses Runware when configured and succeeds", async () => {
        mockRunwareGenerate.mockResolvedValue(Buffer.from("fake-image-data"));

        const result = await generateRecipeImage(
          {
            title: "Chicken Salad",
            productName: "Chicken",
            cuisine: "American",
            mealTypes: ["dinner"],
          },
          { skipLLM: true },
        );

        // Runware returns JPEG bytes (no outputFormat requested) — the stored
        // label must match: .jpg / image/jpeg, not .png / image/png.
        expect(result).toMatch(/^\/api\/recipe-images\/recipe-.+\.jpg$/);
        expect(mockRunwareGenerate).toHaveBeenCalled();
        const promptArg = mockRunwareGenerate.mock.calls[0][0].prompt;
        expect(promptArg).toMatch(/editorial food photography/i);
        expect(promptArg).not.toMatch(/no text|watermark/i);
      });

      it("passes width/height through to Runware", async () => {
        mockRunwareGenerate.mockResolvedValue(Buffer.from("fake-image-data"));

        await generateRecipeImage(
          { title: "Tacos" },
          { skipLLM: true, width: 768, height: 576 },
        );

        expect(mockRunwareGenerate).toHaveBeenCalledWith(
          expect.objectContaining({ width: 768, height: 576 }),
        );
      });

      it("returns null when Runware returns no image", async () => {
        mockRunwareGenerate.mockResolvedValue(null);

        const result = await generateRecipeImage({
          title: "Chicken Salad",
          productName: "Chicken",
        });

        expect(result).toBeNull();
        expect(mockRunwareGenerate).toHaveBeenCalledTimes(1);
      });

      it("returns null when Runware throws", async () => {
        mockRunwareGenerate.mockRejectedValue(new Error("Runware down"));

        const result = await generateRecipeImage({
          title: "Chicken Salad",
          productName: "Chicken",
        });

        expect(result).toBeNull();
        expect(mockRunwareGenerate).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("generateFullRecipe", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("returns recipe content with imageUrl null (image generated async via generateAndPatchRecipeImage)", async () => {
      const recipe = {
        title: "Grilled Salmon",
        description: "Delicious salmon",
        difficulty: "Medium",
        timeEstimate: "30 min",
        ingredients: [{ name: "salmon fillet", quantity: "2", unit: "" }],
        instructions: "Grill the salmon",
        dietTags: ["high-protein"],
      };

      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(recipe) } }],
      } as any);

      const result = await generateFullRecipe({ productName: "Salmon" });

      expect(result.title).toBe("Grilled Salmon");
      expect(result.imageUrl).toBeNull();
    });
  });

  describe("generateAndPatchRecipeImage", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      runwareMock.isRunwareConfigured = true;
    });

    afterEach(() => {
      runwareMock.isRunwareConfigured = false;
    });

    it("patches DB with imageUrl when image generation succeeds", async () => {
      mockRunwareGenerate.mockResolvedValue(Buffer.from("fake-image-data"));

      await generateAndPatchRecipeImage(42, {
        title: "Grilled Salmon",
        productName: "Salmon",
      });

      expect(mockUpdateCommunityRecipeImageUrl).toHaveBeenCalledWith(
        42,
        expect.stringMatching(/^\/api\/recipe-images\/recipe-.+\.jpg$/),
      );
    });

    it("skips DB update when generateRecipeImage returns null", async () => {
      mockRunwareGenerate.mockResolvedValue(null);

      await generateAndPatchRecipeImage(42, {
        title: "Grilled Salmon",
        productName: "Salmon",
      });

      expect(mockUpdateCommunityRecipeImageUrl).not.toHaveBeenCalled();
    });

    it("catches and swallows errors without rethrowing", async () => {
      mockRunwareGenerate.mockRejectedValue(new Error("Runware unavailable"));

      await expect(
        generateAndPatchRecipeImage(42, {
          title: "Grilled Salmon",
          productName: "Salmon",
        }),
      ).resolves.toBeUndefined();
      expect(mockUpdateCommunityRecipeImageUrl).not.toHaveBeenCalled();
    });
  });
});
