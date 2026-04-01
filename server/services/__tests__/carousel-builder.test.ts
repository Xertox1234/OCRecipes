import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildCarousel } from "../carousel-builder";
import { storage } from "../../storage";
import { searchCatalogRecipes } from "../recipe-catalog";
import { generateMealSuggestions } from "../meal-suggestions";
import type { UserProfile } from "@shared/schema";

vi.mock("../../storage", () => ({
  storage: {
    getDismissedRecipeIds: vi.fn(),
    getRecentCommunityRecipes: vi.fn(),
    getCarouselCache: vi.fn(),
    setCarouselCache: vi.fn(),
  },
}));

vi.mock("../recipe-catalog", () => ({
  searchCatalogRecipes: vi.fn(),
}));

vi.mock("../meal-suggestions", () => ({
  generateMealSuggestions: vi.fn(),
}));

const mockProfile: UserProfile = {
  id: 1,
  userId: "1",
  allergies: [{ name: "peanuts", severity: "severe" as const }],
  healthConditions: [],
  dietType: "keto",
  foodDislikes: [],
  primaryGoal: "lose_weight",
  activityLevel: "moderate",
  householdSize: 1,
  cuisinePreferences: ["italian"],
  cookingSkillLevel: "intermediate",
  cookingTimeAvailable: "30_60",
  glp1Mode: false,
  glp1Medication: null,
  glp1StartDate: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockCommunityRecipes = [
  {
    id: 1,
    authorId: "2",
    barcode: null,
    normalizedProductName: "pasta primavera",
    title: "Pasta Primavera",
    description: "A fresh pasta dish",
    difficulty: "Easy",
    timeEstimate: "25 minutes",
    servings: 2,
    dietTags: ["keto"],
    instructions: ["Cook the pasta..."],
    ingredients: [],
    imageUrl: "https://example.com/pasta.jpg",
    isPublic: true,
    likeCount: 5,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 2,
    authorId: "3",
    barcode: null,
    normalizedProductName: "grilled salmon",
    title: "Grilled Salmon",
    description: "Omega-3 rich salmon",
    difficulty: "Medium",
    timeEstimate: "35 minutes",
    servings: 2,
    dietTags: ["keto", "paleo"],
    instructions: ["Grill the salmon..."],
    ingredients: [],
    imageUrl: null,
    isPublic: true,
    likeCount: 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

describe("carousel-builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getDismissedRecipeIds).mockResolvedValue(new Set());
    vi.mocked(storage.setCarouselCache).mockResolvedValue(undefined);
  });

  describe("buildCarousel (free user)", () => {
    it("returns normalized community recipes", async () => {
      vi.mocked(storage.getRecentCommunityRecipes).mockResolvedValue(
        mockCommunityRecipes,
      );

      const cards = await buildCarousel("1", mockProfile, false);

      expect(cards).toHaveLength(2);
      expect(cards[0].id).toBe("community:1");
      expect(cards[0].source).toBe("community");
      expect(cards[0].title).toBe("Pasta Primavera");
      expect(cards[0].imageUrl).toBe("https://example.com/pasta.jpg");
      expect(cards[0].prepTimeMinutes).toBe(25);
      expect(cards[0].recommendationReason).toBe("Matches your keto diet");
    });

    it("filters out dismissed recipes", async () => {
      vi.mocked(storage.getDismissedRecipeIds).mockResolvedValue(
        new Set(["community:1"]),
      );
      vi.mocked(storage.getRecentCommunityRecipes).mockResolvedValue(
        mockCommunityRecipes,
      );

      const cards = await buildCarousel("1", mockProfile, false);

      expect(cards).toHaveLength(1);
      expect(cards[0].id).toBe("community:2");
    });

    it("does not call AI or catalog services", async () => {
      vi.mocked(storage.getRecentCommunityRecipes).mockResolvedValue([]);

      await buildCarousel("1", mockProfile, false);

      expect(searchCatalogRecipes).not.toHaveBeenCalled();
      expect(generateMealSuggestions).not.toHaveBeenCalled();
    });

    it("generates fallback reason for recipes without diet match", async () => {
      const noDietRecipe = {
        ...mockCommunityRecipes[0],
        dietTags: [],
        timeEstimate: "20 minutes",
      };
      vi.mocked(storage.getRecentCommunityRecipes).mockResolvedValue([
        noDietRecipe,
      ]);

      const cards = await buildCarousel("1", mockProfile, false);

      expect(cards[0].recommendationReason).toBe(
        "Quick and easy — under 30 minutes",
      );
    });

    it("handles null profile gracefully", async () => {
      vi.mocked(storage.getRecentCommunityRecipes).mockResolvedValue(
        mockCommunityRecipes,
      );

      const cards = await buildCarousel("1", null, false);

      expect(cards).toHaveLength(2);
      expect(cards[0].recommendationReason).toBe("Recently added recipe");
    });

    it("limits results to 8", async () => {
      const manyRecipes = Array.from({ length: 12 }, (_, i) => ({
        ...mockCommunityRecipes[0],
        id: i + 1,
      }));
      vi.mocked(storage.getRecentCommunityRecipes).mockResolvedValue(
        manyRecipes,
      );

      const cards = await buildCarousel("1", mockProfile, false);

      expect(cards.length).toBeLessThanOrEqual(8);
    });
  });

  describe("buildCarousel (premium user)", () => {
    it("returns AI + catalog cards", async () => {
      vi.mocked(storage.getCarouselCache).mockResolvedValue(null);
      vi.mocked(generateMealSuggestions).mockResolvedValue([
        {
          title: "AI Keto Bowl",
          description: "A keto-friendly bowl",
          reasoning: "Fits your remaining calorie budget",
          calories: 400,
          protein: 30,
          carbs: 10,
          fat: 25,
          prepTimeMinutes: 15,
          difficulty: "Easy" as const,
          ingredients: [{ name: "chicken" }],
          instructions: ["Mix ingredients..."],
          dietTags: ["keto"],
        },
      ]);
      vi.mocked(searchCatalogRecipes).mockResolvedValue({
        results: [
          {
            id: 100,
            title: "Spoonacular Recipe",
            image: "https://example.com/spoon.jpg",
            readyInMinutes: 30,
          },
        ],
        offset: 0,
        number: 1,
        totalResults: 1,
      });

      const cards = await buildCarousel("1", mockProfile, true);

      // AI cards should come first
      expect(cards[0].source).toBe("ai");
      expect(cards[0].title).toBe("AI Keto Bowl");
      expect(cards[0].recommendationReason).toBe(
        "Fits your remaining calorie budget",
      );

      // Catalog cards second
      const catalogCard = cards.find((c) => c.source === "catalog");
      expect(catalogCard).toBeDefined();
      expect(catalogCard!.title).toBe("Spoonacular Recipe");
    });

    it("uses cached AI suggestions when available", async () => {
      const cachedCards = [
        {
          id: "ai:abc123",
          source: "ai" as const,
          title: "Cached AI Recipe",
          imageUrl: null,
          prepTimeMinutes: 20,
          recommendationReason: "From cache",
          recipeData: {} as any,
        },
      ];
      vi.mocked(storage.getCarouselCache).mockResolvedValue(cachedCards);
      vi.mocked(searchCatalogRecipes).mockResolvedValue({
        results: [],
        offset: 0,
        number: 0,
        totalResults: 0,
      });

      const cards = await buildCarousel("1", mockProfile, true);

      expect(generateMealSuggestions).not.toHaveBeenCalled();
      expect(cards[0].title).toBe("Cached AI Recipe");
    });

    it("gracefully handles Spoonacular failure", async () => {
      vi.mocked(storage.getCarouselCache).mockResolvedValue(null);
      vi.mocked(generateMealSuggestions).mockResolvedValue([]);
      vi.mocked(searchCatalogRecipes).mockRejectedValue(
        new Error("API quota exceeded"),
      );

      const cards = await buildCarousel("1", mockProfile, true);

      // Should not throw, just return whatever AI cards we have
      expect(cards).toEqual([]);
    });

    it("gracefully handles AI generation failure", async () => {
      vi.mocked(storage.getCarouselCache).mockResolvedValue(null);
      vi.mocked(generateMealSuggestions).mockRejectedValue(
        new Error("OpenAI timeout"),
      );
      vi.mocked(searchCatalogRecipes).mockResolvedValue({
        results: [{ id: 100, title: "Fallback Recipe", readyInMinutes: 25 }],
        offset: 0,
        number: 1,
        totalResults: 1,
      });

      const cards = await buildCarousel("1", mockProfile, true);

      // Should still return catalog cards
      expect(cards).toHaveLength(1);
      expect(cards[0].source).toBe("catalog");
    });
  });
});
