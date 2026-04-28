import fs from "node:fs";
import {
  normalizeProductName,
  generateRecipeContent,
  generateRecipeImage,
  generateFullRecipe,
  generateAndPatchRecipeImage,
} from "../recipe-generation";

import { openai, dalleClient } from "../../lib/openai";

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
vi.mock("../../lib/openai", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
  dalleClient: {
    images: {
      generate: vi.fn(),
    },
  },
  OPENAI_TIMEOUT_HEAVY_MS: 60_000,
  OPENAI_TIMEOUT_IMAGE_MS: 120_000,
  MODEL_FAST: "gpt-4o-mini",
  MODEL_HEAVY: "gpt-4o",
}));

// Mock storage for generateAndPatchRecipeImage
const mockUpdateCommunityRecipeImageUrl = vi.fn().mockResolvedValue(undefined);
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

const mockCreate = vi.mocked(openai.chat.completions.create);
const mockImageGenerate = vi.mocked(dalleClient.images.generate);
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

      const prompt = mockCreate.mock.calls[0][0].messages[1].content as string;
      expect(prompt).toContain("Peanuts");
      expect(prompt).toContain("vegan");
      expect(prompt).toContain("gluten-free");
    });
  });

  describe("generateRecipeImage", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("saves image to disk and returns URL path on success", async () => {
      mockImageGenerate.mockResolvedValue({
        data: [{ b64_json: "abc123base64data" }],
      } as any);

      const result = await generateRecipeImage("Chicken Salad", "Chicken");

      expect(result).toMatch(/^\/api\/recipe-images\/recipe-.+\.png$/);
      expect(fs.promises.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("recipe-"),
        expect.any(Buffer),
      );
    });

    it("returns null when DALL-E returns no data", async () => {
      mockImageGenerate.mockResolvedValue({
        data: [{ b64_json: undefined }],
      } as any);

      const result = await generateRecipeImage("Chicken Salad", "Chicken");

      expect(result).toBeNull();
    });

    it("returns null on DALL-E error", async () => {
      mockImageGenerate.mockRejectedValue(new Error("API error"));

      const result = await generateRecipeImage("Chicken Salad", "Chicken");

      expect(result).toBeNull();
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

        const result = await generateRecipeImage("Chicken Salad", "Chicken");

        expect(result).toMatch(/^\/api\/recipe-images\/recipe-.+\.png$/);
        expect(mockRunwareGenerate).toHaveBeenCalled();
        expect(mockImageGenerate).not.toHaveBeenCalled();
      });

      it("falls back to DALL-E when Runware returns null", async () => {
        mockRunwareGenerate.mockResolvedValue(null);
        mockImageGenerate.mockResolvedValue({
          data: [{ b64_json: "dalle-fallback-data" }],
        } as any);

        const result = await generateRecipeImage("Chicken Salad", "Chicken");

        expect(result).toMatch(/^\/api\/recipe-images\/recipe-.+\.png$/);
        expect(mockRunwareGenerate).toHaveBeenCalled();
        expect(mockImageGenerate).toHaveBeenCalled();
      });

      it("falls back to DALL-E when Runware throws", async () => {
        mockRunwareGenerate.mockRejectedValue(new Error("Runware down"));
        mockImageGenerate.mockResolvedValue({
          data: [{ b64_json: "dalle-fallback-data" }],
        } as any);

        const result = await generateRecipeImage("Chicken Salad", "Chicken");

        expect(result).toMatch(/^\/api\/recipe-images\/recipe-.+\.png$/);
        expect(mockImageGenerate).toHaveBeenCalled();
      });

      it("returns null when both Runware and DALL-E fail", async () => {
        mockRunwareGenerate.mockRejectedValue(new Error("Runware down"));
        mockImageGenerate.mockRejectedValue(new Error("DALL-E down"));

        const result = await generateRecipeImage("Chicken Salad", "Chicken");

        expect(result).toBeNull();
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
    });

    it("patches DB with imageUrl when image generation succeeds", async () => {
      mockImageGenerate.mockResolvedValue({
        data: [{ b64_json: "abc123base64data" }],
      } as any);

      await generateAndPatchRecipeImage(42, "Grilled Salmon", "Salmon");

      expect(mockUpdateCommunityRecipeImageUrl).toHaveBeenCalledWith(
        42,
        expect.stringMatching(/^\/api\/recipe-images\/recipe-.+\.png$/),
      );
    });

    it("skips DB update when generateRecipeImage returns null", async () => {
      mockImageGenerate.mockResolvedValue({
        data: [{ b64_json: undefined }],
      } as any);

      await generateAndPatchRecipeImage(42, "Grilled Salmon", "Salmon");

      expect(mockUpdateCommunityRecipeImageUrl).not.toHaveBeenCalled();
    });

    it("catches and swallows errors without rethrowing", async () => {
      mockImageGenerate.mockRejectedValue(new Error("DALL-E unavailable"));

      await expect(
        generateAndPatchRecipeImage(42, "Grilled Salmon", "Salmon"),
      ).resolves.toBeUndefined();
      expect(mockUpdateCommunityRecipeImageUrl).not.toHaveBeenCalled();
    });
  });
});
