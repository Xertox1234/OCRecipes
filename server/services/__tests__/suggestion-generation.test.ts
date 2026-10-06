import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateSuggestions,
  generateInstructions,
  SuggestionParseError,
} from "../suggestion-generation";
import type {
  GenerateSuggestionsInput,
  GenerateInstructionsInput,
} from "../suggestion-generation";
import { aiChat } from "../../lib/ai-client";
import {
  createMockChatCompletion,
  createMockUserProfile,
} from "../../__tests__/factories";

vi.mock("../../lib/ai-client", () => ({ aiChat: vi.fn() }));
vi.mock("../../lib/openai", () => ({
  OPENAI_TIMEOUT_FAST_MS: 15_000,
}));

vi.mock("../../lib/ai-safety", () => ({
  sanitizeUserInput: (input: string) => input,
  SYSTEM_PROMPT_BOUNDARY: "---BOUNDARY---",
}));

vi.mock("../../lib/dietary-context", () => ({
  buildDietaryContext: vi.fn().mockReturnValue(""),
}));

describe("suggestion-generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("generateSuggestions", () => {
    const baseInput: GenerateSuggestionsInput = {
      productName: "Greek Yogurt",
      brandName: "Fage",
      userProfile: null,
    };

    it("parses valid AI response and returns suggestions", async () => {
      const suggestions = [
        {
          type: "recipe",
          title: "Yogurt Bowl",
          description: "A healthy bowl",
          difficulty: "Easy",
          timeEstimate: "10 min",
        },
        {
          type: "craft",
          title: "Yogurt Art",
          description: "Fun activity",
          timeEstimate: "20 min",
        },
        {
          type: "pairing",
          title: "Yogurt and Granola",
          description: "Perfect combo",
        },
        {
          type: "recipe",
          title: "Smoothie",
          description: "Blend it",
          difficulty: "Easy",
          timeEstimate: "5 min",
        },
      ];

      vi.mocked(aiChat).mockResolvedValue(
        createMockChatCompletion(JSON.stringify({ suggestions })),
      );

      const result = await generateSuggestions(baseInput);
      expect(result).toHaveLength(4);
      expect(result[0].title).toBe("Yogurt Bowl");
      expect(result[0].type).toBe("recipe");
      expect(result[2].type).toBe("pairing");
    });

    it("passes user profile context to AI call", async () => {
      const profile = createMockUserProfile({
        dietType: "vegetarian",
        allergies: [{ name: "peanuts", severity: "severe" as const }],
      });

      vi.mocked(aiChat).mockResolvedValue(
        createMockChatCompletion(
          JSON.stringify({
            suggestions: [
              { type: "recipe", title: "Veggie Bowl", description: "Healthy" },
            ],
          }),
        ),
      );

      const result = await generateSuggestions({
        ...baseInput,
        userProfile: profile,
      });
      expect(result).toHaveLength(1);
      expect(aiChat).toHaveBeenCalledTimes(1);
      expect(vi.mocked(aiChat).mock.calls[0][0]).toBe("suggestion-generate");
    });

    it("throws SuggestionParseError when AI returns invalid JSON", async () => {
      vi.mocked(aiChat).mockResolvedValue(
        createMockChatCompletion("not valid json {{{"),
      );

      await expect(generateSuggestions(baseInput)).rejects.toThrow(
        SuggestionParseError,
      );
      await expect(generateSuggestions(baseInput)).rejects.toThrow(
        "AI returned invalid JSON",
      );
    });

    it("throws SuggestionParseError when AI returns unexpected format", async () => {
      // Valid JSON but doesn't match schema (empty suggestions array)
      vi.mocked(aiChat).mockResolvedValue(
        createMockChatCompletion(JSON.stringify({ suggestions: [] })),
      );

      await expect(generateSuggestions(baseInput)).rejects.toThrow(
        SuggestionParseError,
      );
      await expect(generateSuggestions(baseInput)).rejects.toThrow(
        "AI returned an unexpected response format",
      );
    });

    it("throws SuggestionParseError when response has wrong structure", async () => {
      vi.mocked(aiChat).mockResolvedValue(
        createMockChatCompletion(
          JSON.stringify({ items: ["not suggestions"] }),
        ),
      );

      await expect(generateSuggestions(baseInput)).rejects.toThrow(
        SuggestionParseError,
      );
    });

    it("handles empty content from AI gracefully", async () => {
      vi.mocked(aiChat).mockResolvedValue(createMockChatCompletion(""));

      // Empty string parses as {} which fails the schema
      await expect(generateSuggestions(baseInput)).rejects.toThrow(
        SuggestionParseError,
      );
    });

    it("handles null brandName", async () => {
      vi.mocked(aiChat).mockResolvedValue(
        createMockChatCompletion(
          JSON.stringify({
            suggestions: [
              { type: "recipe", title: "Simple Bowl", description: "Easy" },
            ],
          }),
        ),
      );

      const result = await generateSuggestions({
        productName: "Yogurt",
        brandName: null,
        userProfile: null,
      });
      expect(result).toHaveLength(1);
    });
  });

  describe("generateInstructions", () => {
    const baseInput: GenerateInstructionsInput = {
      productName: "Greek Yogurt",
      brandName: "Fage",
      suggestionTitle: "Yogurt Bowl",
      suggestionType: "recipe",
      userProfile: null,
    };

    it("returns instructions text for recipe type", async () => {
      vi.mocked(aiChat).mockResolvedValue(
        createMockChatCompletion("Step 1: Mix yogurt with honey..."),
      );

      const result = await generateInstructions(baseInput);
      expect(result).toContain("Mix yogurt");
    });

    it("returns instructions for craft type", async () => {
      vi.mocked(aiChat).mockResolvedValue(
        createMockChatCompletion("Materials: empty yogurt cup..."),
      );

      const result = await generateInstructions({
        ...baseInput,
        suggestionType: "craft",
        suggestionTitle: "Yogurt Cup Craft",
      });
      expect(result).toContain("yogurt cup");
      expect(vi.mocked(aiChat).mock.calls[0][0]).toBe(
        "suggestion-instructions",
      );
    });

    it("returns instructions for pairing type", async () => {
      vi.mocked(aiChat).mockResolvedValue(
        createMockChatCompletion("These pair well because of the contrast..."),
      );

      const result = await generateInstructions({
        ...baseInput,
        suggestionType: "pairing",
        suggestionTitle: "Yogurt and Granola",
      });
      expect(result).toContain("pair well");
    });

    it("returns fallback text when AI returns empty content", async () => {
      vi.mocked(aiChat).mockResolvedValue(createMockChatCompletion(""));

      const result = await generateInstructions(baseInput);
      expect(result).toBe("Unable to generate instructions.");
    });

    it("propagates OpenAI API errors", async () => {
      vi.mocked(aiChat).mockRejectedValue(new Error("API rate limit exceeded"));

      await expect(generateInstructions(baseInput)).rejects.toThrow(
        "API rate limit exceeded",
      );
    });
  });

  describe("SuggestionParseError", () => {
    it("is an instance of Error", () => {
      const error = new SuggestionParseError("test error");
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("SuggestionParseError");
      expect(error.message).toBe("test error");
    });
  });
});
