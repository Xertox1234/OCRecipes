import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
    isCanonical: false,
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
    isCanonical: false,
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

  describe("userHour parameter", () => {
    it("UTC user (no userHour): falls back to server time — ordering matches explicit pass of current hour", async () => {
      const dinnerRecipe = {
        ...mockCommunityRecipes[0],
        id: 50,
        title: "Steak",
        mealTypes: ["dinner"],
      };
      const breakfastRecipe = {
        ...mockCommunityRecipes[0],
        id: 51,
        title: "Oatmeal",
        mealTypes: ["breakfast"],
      };
      vi.mocked(storage.getRecentCommunityRecipes).mockResolvedValue([
        breakfastRecipe,
        dinnerRecipe,
      ]);

      // Capture the current hour before both calls so they share the same value.
      const currentHour = new Date().getHours();

      // Both calls must return identical orderings: one via fallback, one explicit.
      const cardsDefault = await buildCarousel("1", mockProfile);
      const cardsExplicit = await buildCarousel("1", mockProfile, currentHour);

      expect(cardsDefault.map((c) => c.title)).toEqual(
        cardsExplicit.map((c) => c.title),
      );
    });

    it("EST user at 7pm (header present): dinner boosted instead of snack (server would use 23:00 UTC)", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-05-09T23:00:00Z")); // 23:00 UTC = snack window

      const dinnerRecipe = {
        ...mockCommunityRecipes[0],
        id: 60,
        title: "Steak",
        mealTypes: ["dinner"],
      };
      const snackRecipe = {
        ...mockCommunityRecipes[0],
        id: 61,
        title: "Chips",
        mealTypes: ["snack"],
      };
      vi.mocked(storage.getRecentCommunityRecipes).mockResolvedValue([
        snackRecipe,
        dinnerRecipe,
      ]);

      // userHour=19 (7pm ET) — dinner window, not snack
      const cards = await buildCarousel("1", mockProfile, 19);

      const titles = cards.map((c) => c.title);
      expect(titles.indexOf("Steak")).toBeLessThan(titles.indexOf("Chips"));

      vi.useRealTimers();
    });

    it("invalid userHour is guarded at route level; buildCarousel with valid 0-23 works correctly", async () => {
      const breakfastRecipe = {
        ...mockCommunityRecipes[0],
        id: 70,
        title: "Toast",
        mealTypes: ["breakfast"],
      };
      const dinnerRecipe = {
        ...mockCommunityRecipes[0],
        id: 71,
        title: "Pasta",
        mealTypes: ["dinner"],
      };
      vi.mocked(storage.getRecentCommunityRecipes).mockResolvedValue([
        dinnerRecipe,
        breakfastRecipe,
      ]);

      // Hour 6 = breakfast window
      const cards = await buildCarousel("1", mockProfile, 6);

      const titles = cards.map((c) => c.title);
      expect(titles.indexOf("Toast")).toBeLessThan(titles.indexOf("Pasta"));
    });
  });

  describe("time-of-day ordering", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("at 7am: breakfast recipe sorts before dinner recipe", async () => {
      vi.setSystemTime(new Date("2026-05-09T07:00:00"));

      const breakfastRecipe = {
        ...mockCommunityRecipes[0],
        id: 10,
        title: "Oatmeal",
        mealTypes: ["breakfast"],
      };
      const dinnerRecipe = {
        ...mockCommunityRecipes[0],
        id: 11,
        title: "Steak",
        mealTypes: ["dinner"],
      };
      // DB returns dinner first (by recency), breakfast second
      vi.mocked(storage.getRecentCommunityRecipes).mockResolvedValue([
        dinnerRecipe,
        breakfastRecipe,
      ]);

      const cards = await buildCarousel("1", mockProfile);

      const titles = cards.map((c) => c.title);
      expect(titles.indexOf("Oatmeal")).toBeLessThan(titles.indexOf("Steak"));
    });

    it("at 18:00: dinner recipe sorts before breakfast recipe", async () => {
      vi.setSystemTime(new Date("2026-05-09T18:00:00"));

      const breakfastRecipe = {
        ...mockCommunityRecipes[0],
        id: 10,
        title: "Oatmeal",
        mealTypes: ["breakfast"],
      };
      const dinnerRecipe = {
        ...mockCommunityRecipes[0],
        id: 11,
        title: "Steak",
        mealTypes: ["dinner"],
      };
      // DB returns breakfast first (by recency), dinner second
      vi.mocked(storage.getRecentCommunityRecipes).mockResolvedValue([
        breakfastRecipe,
        dinnerRecipe,
      ]);

      const cards = await buildCarousel("1", mockProfile);

      const titles = cards.map((c) => c.title);
      expect(titles.indexOf("Steak")).toBeLessThan(titles.indexOf("Oatmeal"));
    });

    it("multi-tagged recipe [lunch, dinner] sorts to front in the lunch window (11:00)", async () => {
      vi.setSystemTime(new Date("2026-05-09T11:00:00"));

      const multiTagRecipe = {
        ...mockCommunityRecipes[0],
        id: 20,
        title: "Burrito",
        mealTypes: ["lunch", "dinner"],
      };
      const breakfastRecipe = {
        ...mockCommunityRecipes[0],
        id: 21,
        title: "Pancakes",
        mealTypes: ["breakfast"],
      };
      // DB returns breakfast first (by recency)
      vi.mocked(storage.getRecentCommunityRecipes).mockResolvedValue([
        breakfastRecipe,
        multiTagRecipe,
      ]);

      const cards = await buildCarousel("1", mockProfile);

      const titles = cards.map((c) => c.title);
      expect(titles.indexOf("Burrito")).toBeLessThan(
        titles.indexOf("Pancakes"),
      );
    });

    it("multi-tagged recipe [lunch, dinner] sorts to front in the dinner window (19:00)", async () => {
      vi.setSystemTime(new Date("2026-05-09T19:00:00"));

      const multiTagRecipe = {
        ...mockCommunityRecipes[0],
        id: 20,
        title: "Burrito",
        mealTypes: ["lunch", "dinner"],
      };
      const breakfastRecipe = {
        ...mockCommunityRecipes[0],
        id: 21,
        title: "Pancakes",
        mealTypes: ["breakfast"],
      };
      // DB returns breakfast first (by recency)
      vi.mocked(storage.getRecentCommunityRecipes).mockResolvedValue([
        breakfastRecipe,
        multiTagRecipe,
      ]);

      const cards = await buildCarousel("1", mockProfile);

      const titles = cards.map((c) => c.title);
      expect(titles.indexOf("Burrito")).toBeLessThan(
        titles.indexOf("Pancakes"),
      );
    });

    it("unclassified recipe (mealTypes: ['unclassified']) stays in its original chronological position relative to other non-matching recipes", async () => {
      vi.setSystemTime(new Date("2026-05-09T07:00:00")); // breakfast window

      const unclassifiedA = {
        ...mockCommunityRecipes[0],
        id: 30,
        title: "Salad A",
        mealTypes: ["unclassified"],
      };
      const dinnerRecipe = {
        ...mockCommunityRecipes[0],
        id: 31,
        title: "Steak",
        mealTypes: ["dinner"],
      };
      const unclassifiedB = {
        ...mockCommunityRecipes[0],
        id: 32,
        title: "Salad B",
        mealTypes: ["unclassified"],
      };
      // DB order: A (most recent), dinner, B
      vi.mocked(storage.getRecentCommunityRecipes).mockResolvedValue([
        unclassifiedA,
        dinnerRecipe,
        unclassifiedB,
      ]);

      const cards = await buildCarousel("1", mockProfile);

      // Neither A nor B match breakfast ("unclassified" is not a MealTimeHint);
      // neither does dinner. All three score "1" (no match), so stable sort
      // preserves original order.
      const titles = cards.map((c) => c.title);
      expect(titles.indexOf("Salad A")).toBeLessThan(titles.indexOf("Steak"));
      expect(titles.indexOf("Steak")).toBeLessThan(titles.indexOf("Salad B"));
    });

    it("recipe with mealTypes: null is treated as non-matching (null-coalescing guard fires)", async () => {
      vi.setSystemTime(new Date("2026-05-09T07:00:00")); // breakfast window

      const breakfastRecipe = {
        ...mockCommunityRecipes[0],
        id: 40,
        title: "Oatmeal",
        mealTypes: ["breakfast"],
      };
      const nullMealTypesRecipe = {
        ...mockCommunityRecipes[0],
        id: 41,
        title: "Mystery Food",
        mealTypes: null as unknown as string[],
      };
      // DB returns null-mealTypes first (more recent), breakfast second
      vi.mocked(storage.getRecentCommunityRecipes).mockResolvedValue([
        nullMealTypesRecipe,
        breakfastRecipe,
      ]);

      const cards = await buildCarousel("1", mockProfile);

      // The null-mealTypes recipe does NOT get boosted (null ?? [] = [], no match).
      // The breakfast recipe gets boosted and should sort before it.
      const titles = cards.map((c) => c.title);
      expect(titles.indexOf("Oatmeal")).toBeLessThan(
        titles.indexOf("Mystery Food"),
      );
    });
  });
});
