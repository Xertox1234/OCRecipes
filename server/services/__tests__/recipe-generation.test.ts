import {
  normalizeProductName,
  generateRecipeContent,
  generateRecipeImage,
  generateFullRecipe,
} from "../recipe-generation";

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
}));

import { openai, dalleClient } from "../../lib/openai";

const mockCreate = vi.mocked(openai.chat.completions.create);
const mockImageGenerate = vi.mocked(dalleClient.images.generate);

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
        instructions: "1. Grill chicken. 2. Toss salad. 3. Combine.",
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
      expect(result.instructions).toContain("Grill chicken");
      expect(result.dietTags).toEqual(["high-protein", "low-carb"]);
    });

    it("handles instructions as array of strings", async () => {
      const mockRecipe = {
        title: "Simple Rice",
        description: "Easy rice dish",
        difficulty: "Easy",
        timeEstimate: "15 min",
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
        instructions: "Mix ingredients together.",
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

    it("returns base64 data URL on success", async () => {
      mockImageGenerate.mockResolvedValue({
        data: [{ b64_json: "abc123base64data" }],
      } as any);

      const result = await generateRecipeImage("Chicken Salad", "Chicken");

      expect(result).toBe("data:image/png;base64,abc123base64data");
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
        instructions: "Grill the salmon.",
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
      expect(result.imageUrl).toBe("data:image/png;base64,imagedata");
    });

    it("returns recipe without image on image generation failure", async () => {
      const recipe = {
        title: "Simple Pasta",
        description: "Quick pasta dish",
        difficulty: "Easy",
        timeEstimate: "15 min",
        instructions: "Cook pasta. Add sauce.",
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
