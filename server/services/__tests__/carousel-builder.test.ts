import { describe, it, expect, vi, beforeEach } from "vitest";
import { buildCarousel } from "../carousel-builder";
import { storage } from "../../storage";
import type { UserProfile } from "@shared/schema";

vi.mock("../../storage", () => ({
  storage: {
    getDismissedRecipeIds: vi.fn(),
    getRecentCommunityRecipes: vi.fn(),
  },
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
  reminderMutes: {},
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
    mealTypes: [],
    instructions: ["Cook the pasta..."],
    ingredients: [],
    caloriesPerServing: null,
    proteinPerServing: null,
    carbsPerServing: null,
    fatPerServing: null,
    imageUrl: "https://example.com/pasta.jpg",
    isPublic: true,
    remixedFromId: null,
    remixedFromTitle: null,
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
    mealTypes: [],
    instructions: ["Grill the salmon..."],
    ingredients: [],
    caloriesPerServing: null,
    proteinPerServing: null,
    carbsPerServing: null,
    fatPerServing: null,
    imageUrl: null,
    isPublic: true,
    remixedFromId: null,
    remixedFromTitle: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

describe("carousel-builder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(storage.getDismissedRecipeIds).mockResolvedValue(new Set());
  });

  it("returns normalized community recipes", async () => {
    vi.mocked(storage.getRecentCommunityRecipes).mockResolvedValue(
      mockCommunityRecipes,
    );

    const cards = await buildCarousel("1", mockProfile);

    expect(cards).toHaveLength(2);
    expect(cards[0].id).toBe(1);
    expect(cards[0].title).toBe("Pasta Primavera");
    expect(cards[0].imageUrl).toBe("https://example.com/pasta.jpg");
    expect(cards[0].prepTimeMinutes).toBe(25);
    expect(cards[0].recommendationReason).toBe("Matches your keto diet");
  });

  it("passes dismissedIds to storage so dismissed recipes are excluded at the DB level", async () => {
    const dismissedIds = new Set([1]);
    vi.mocked(storage.getDismissedRecipeIds).mockResolvedValue(dismissedIds);
    // Storage already filtered: only recipe 2 is returned
    vi.mocked(storage.getRecentCommunityRecipes).mockResolvedValue([
      mockCommunityRecipes[1],
    ]);

    const cards = await buildCarousel("1", mockProfile);

    // Verify storage was called with the dismissed set
    expect(storage.getRecentCommunityRecipes).toHaveBeenCalledWith(
      "1",
      expect.objectContaining({ dismissedIds }),
    );
    // Result contains no dismissed IDs
    expect(cards.map((c) => c.id)).not.toContain(1);
    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe(2);
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

    const cards = await buildCarousel("1", mockProfile);

    expect(cards[0].recommendationReason).toBe(
      "Quick and easy — under 30 minutes",
    );
  });

  it("handles null profile gracefully", async () => {
    vi.mocked(storage.getRecentCommunityRecipes).mockResolvedValue(
      mockCommunityRecipes,
    );

    const cards = await buildCarousel("1", null);

    expect(cards).toHaveLength(2);
    expect(cards[0].recommendationReason).toBe("Recently added recipe");
  });

  it("limits results to 8", async () => {
    const manyRecipes = Array.from({ length: 12 }, (_, i) => ({
      ...mockCommunityRecipes[0],
      id: i + 1,
    }));
    vi.mocked(storage.getRecentCommunityRecipes).mockResolvedValue(manyRecipes);

    const cards = await buildCarousel("1", mockProfile);

    expect(cards.length).toBeLessThanOrEqual(8);
  });
});
