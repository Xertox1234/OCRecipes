import fs from "node:fs";
import {
  normalizeProductName,
  generateRecipeContent,
  generateRecipeImage,
  generateFullRecipe,
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

    it("returns recipe content with image", async () => {
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

      mockImageGenerate.mockResolvedValue({
        data: [{ b64_json: "imagedata" }],
      } as any);

      const result = await generateFullRecipe({ productName: "Salmon" });

      expect(result.title).toBe("Grilled Salmon");
      expect(result.imageUrl).toMatch(/^\/api\/recipe-images\/recipe-.+\.png$/);
    });

    it("returns recipe without image on image generation failure", async () => {
      const recipe = {
        title: "Simple Pasta",
        description: "Quick pasta dish",
        difficulty: "Easy",
        timeEstimate: "15 min",
        ingredients: [{ name: "pasta", quantity: "200", unit: "g" }],
        instructions: "Cook pasta\nAdd sauce",
        dietTags: [],
      };

      mockCreate.mockResolvedValue({
        choices: [{ message: { content: JSON.stringify(recipe) } }],
      } as any);

      mockImageGenerate.mockRejectedValue(new Error("DALL-E unavailable"));

      const result = await generateFullRecipe({ productName: "Pasta" });

      expect(result.title).toBe("Simple Pasta");
      expect(result.imageUrl).toBeNull();
    });
  });
});
