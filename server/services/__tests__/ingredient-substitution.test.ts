import { getSubstitutions, _testInternals } from "../ingredient-substitution";
import { openai } from "../../lib/openai";
import type { CookingSessionIngredient } from "@shared/types/cook-session";
import type { UserProfile } from "@shared/schema";

vi.mock("../../lib/openai", () => ({
  openai: {
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
  },
  OPENAI_TIMEOUT_HEAVY_MS: 60_000,
}));

vi.mock("../../lib/ai-safety", () => ({
  sanitizeUserInput: vi.fn((text: string) => text),
  SYSTEM_PROMPT_BOUNDARY: "---BOUNDARY---",
}));

const mockCreate = vi.mocked(openai.chat.completions.create);

const {
  findStaticSubstitutions,
  buildDietaryProfileSummary,
  extractDietaryTags,
  COMMON_SUBSTITUTIONS,
} = _testInternals;

function makeIngredient(
  overrides: Partial<CookingSessionIngredient> & { name: string },
): CookingSessionIngredient {
  return {
    id: crypto.randomUUID(),
    quantity: 100,
    unit: "g",
    confidence: 0.9,
    category: "other",
    photoId: "photo-1",
    userEdited: false,
    ...overrides,
  };
}

describe("ingredient-substitution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findStaticSubstitutions", () => {
    it("returns substitutions for known ingredients", () => {
      const results = findStaticSubstitutions("butter", []);
      expect(results.length).toBeGreaterThan(0);
      expect(results[0].name).toBeDefined();
    });

    it("returns empty for unknown ingredients", () => {
      const results = findStaticSubstitutions("exotic dragon fruit", []);
      expect(results).toEqual([]);
    });

    it("is case-insensitive", () => {
      const results = findStaticSubstitutions("Butter", []);
      expect(results.length).toBeGreaterThan(0);
    });

    it("prioritizes matching dietary tags", () => {
      const results = findStaticSubstitutions("butter", [
        "dairy-free",
        "vegan",
      ]);

      // Should only return dairy-free/vegan subs when tags match
      for (const sub of results) {
        expect(sub.tags.some((t) => ["dairy-free", "vegan"].includes(t))).toBe(
          true,
        );
      }
    });

    it("returns all subs when no dietary tags match", () => {
      const all = findStaticSubstitutions("butter", []);
      const withTags = findStaticSubstitutions("butter", ["non-existent-tag"]);

      // With no matching tags, falls through to returning all subs
      expect(withTags.length).toBe(all.length);
    });
  });

  describe("buildDietaryProfileSummary", () => {
    it("returns default message for null profile", () => {
      expect(buildDietaryProfileSummary(null)).toBe("No dietary profile set");
    });

    it("includes diet type", () => {
      const profile = { dietType: "vegan" } as UserProfile;
      const summary = buildDietaryProfileSummary(profile);
      expect(summary).toContain("Diet: vegan");
    });

    it("includes allergies", () => {
      const profile = {
        allergies: [{ name: "Peanuts" }, { name: "Dairy" }],
      } as UserProfile;
      const summary = buildDietaryProfileSummary(profile);
      expect(summary).toContain("Allergies: Peanuts, Dairy");
    });

    it("includes food dislikes", () => {
      const profile = {
        foodDislikes: ["cilantro", "olives"],
      } as UserProfile;
      const summary = buildDietaryProfileSummary(profile);
      expect(summary).toContain("Dislikes: cilantro, olives");
    });

    it("includes primary goal", () => {
      const profile = {
        primaryGoal: "weight_loss",
      } as UserProfile;
      const summary = buildDietaryProfileSummary(profile);
      expect(summary).toContain("Goal: weight_loss");
    });
  });

  describe("extractDietaryTags", () => {
    it("returns empty for null profile", () => {
      expect(extractDietaryTags(null)).toEqual([]);
    });

    it("extracts vegan tags", () => {
      const tags = extractDietaryTags({
        dietType: "vegan",
      } as UserProfile);
      expect(tags).toContain("vegan");
      expect(tags).toContain("dairy-free");
      expect(tags).toContain("egg-free");
    });

    it("extracts keto tags", () => {
      const tags = extractDietaryTags({
        dietType: "keto",
      } as UserProfile);
      expect(tags).toContain("low-carb");
      expect(tags).toContain("keto");
    });

    it("extracts tags from allergies", () => {
      const tags = extractDietaryTags({
        allergies: [{ name: "Dairy" }, { name: "Gluten" }],
      } as UserProfile);
      expect(tags).toContain("dairy-free");
      expect(tags).toContain("gluten-free");
    });

    it("deduplicates tags", () => {
      const tags = extractDietaryTags({
        dietType: "vegan",
        allergies: [{ name: "Dairy" }],
      } as UserProfile);

      // "dairy-free" should appear only once
      const dairyCount = tags.filter((t) => t === "dairy-free").length;
      expect(dairyCount).toBe(1);
    });
  });

  describe("getSubstitutions", () => {
    it("uses static lookup for common ingredients without calling AI", async () => {
      const ingredients = [makeIngredient({ name: "butter" })];
      const result = await getSubstitutions(ingredients, null);

      expect(result.suggestions.length).toBeGreaterThan(0);
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("falls back to AI for uncommon ingredients", async () => {
      const ingredients = [makeIngredient({ name: "saffron" })];

      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: JSON.stringify({
                suggestions: [
                  {
                    originalIngredientId: ingredients[0].id,
                    substitute: "turmeric",
                    reason: "Similar color and mild flavor",
                    ratio: "1 tsp per pinch",
                    macroDelta: {
                      calories: 0,
                      protein: 0,
                      carbs: 0,
                      fat: 0,
                    },
                    confidence: 0.8,
                  },
                ],
              }),
            },
            index: 0,
            finish_reason: "stop",
          },
        ],
        id: "test",
        model: "gpt-4o",
        object: "chat.completion",
        created: Date.now(),
      } as any);

      const result = await getSubstitutions(ingredients, null);

      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions[0].substitute).toBe("turmeric");
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it("returns static results even if AI fails", async () => {
      const ingredients = [
        makeIngredient({ name: "butter" }),
        makeIngredient({ name: "saffron" }),
      ];

      mockCreate.mockRejectedValueOnce(new Error("API error"));

      const result = await getSubstitutions(ingredients, null);

      // Static butter results should still be present
      expect(result.suggestions.length).toBeGreaterThan(0);
      const butterSubs = result.suggestions.filter(
        (s) => s.originalIngredientId === ingredients[0].id,
      );
      expect(butterSubs.length).toBeGreaterThan(0);
    });

    it("includes dietary profile summary", async () => {
      const ingredients = [makeIngredient({ name: "butter" })];
      const profile = { dietType: "vegan" } as UserProfile;

      const result = await getSubstitutions(ingredients, profile);

      expect(result.dietaryProfileSummary).toContain("Diet: vegan");
    });

    it("prioritizes dietary-matching substitutions", async () => {
      const ingredients = [makeIngredient({ name: "butter" })];
      const profile = { dietType: "vegan" } as UserProfile;

      const result = await getSubstitutions(ingredients, profile);

      // All returned static subs should match vegan/dairy-free tags
      for (const suggestion of result.suggestions) {
        // Static subs have "Common substitution" as reason prefix
        if (suggestion.reason.startsWith("Common substitution")) {
          expect(suggestion.reason).toMatch(/dairy-free|vegan/);
        }
      }
    });

    it("sets confidence to 0.9 for static substitutions", async () => {
      const ingredients = [makeIngredient({ name: "rice" })];
      const result = await getSubstitutions(ingredients, null);

      for (const suggestion of result.suggestions) {
        expect(suggestion.confidence).toBe(0.9);
      }
    });
  });

  describe("static substitution data", () => {
    it("has valid macro deltas for all substitutions", () => {
      for (const [, subs] of Object.entries(COMMON_SUBSTITUTIONS)) {
        for (const sub of subs) {
          expect(typeof sub.macroDelta.calories).toBe("number");
          expect(typeof sub.macroDelta.protein).toBe("number");
          expect(typeof sub.macroDelta.carbs).toBe("number");
          expect(typeof sub.macroDelta.fat).toBe("number");
        }
      }
    });

    it("has non-empty tags for all substitutions", () => {
      for (const [, subs] of Object.entries(COMMON_SUBSTITUTIONS)) {
        for (const sub of subs) {
          expect(sub.tags.length).toBeGreaterThan(0);
        }
      }
    });
  });
});
