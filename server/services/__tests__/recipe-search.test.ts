import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MealPlanRecipe, CommunityRecipe } from "@shared/schema";

// Import after mocks
import {
  mealPlanToSearchable,
  communityToSearchable,
  searchRecipes,
  initSearchIndex,
  resetSearchIndex,
  addToIndex,
  removeFromIndex,
} from "../recipe-search";
import { storage } from "../../storage";

vi.mock("../../storage", () => ({
  storage: {
    getAllMealPlanRecipes: vi.fn().mockResolvedValue([]),
    getAllPublicCommunityRecipes: vi.fn().mockResolvedValue([]),
    getAllRecipeIngredients: vi.fn().mockResolvedValue(new Map()),
    getPantryItems: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../../services/recipe-catalog", () => ({
  searchCatalogRecipes: vi.fn().mockResolvedValue({
    results: [],
    offset: 0,
    number: 0,
    totalResults: 0,
  }),
  getCatalogRecipeDetail: vi.fn().mockResolvedValue(null),
}));

// Base fixtures
const baseMealPlanRecipe: MealPlanRecipe = {
  id: 1,
  userId: "user1",
  title: "Chicken Parmesan",
  description: "Classic Italian comfort food",
  sourceType: "user_created",
  sourceUrl: null,
  externalId: null,
  cuisine: "Italian",
  difficulty: "Medium",
  servings: 4,
  prepTimeMinutes: 15,
  cookTimeMinutes: 30,
  imageUrl: null,
  instructions: ["Bread the chicken", "Bake with sauce"],
  dietTags: ["gluten free"],
  mealTypes: ["dinner"],
  caloriesPerServing: "450",
  proteinPerServing: "35",
  carbsPerServing: "20",
  fatPerServing: "25",
  fiberPerServing: null,
  sugarPerServing: null,
  sodiumPerServing: null,
  createdAt: new Date("2024-06-01"),
  updatedAt: new Date("2024-06-01"),
};

const baseCommunityRecipe: CommunityRecipe = {
  id: 10,
  authorId: "author1",
  barcode: null,
  normalizedProductName: "chicken",
  title: "Grilled Chicken Salad",
  description: "Healthy and fresh",
  difficulty: "Easy",
  timeEstimate: "20 min",
  servings: 2,
  dietTags: ["vegetarian"],
  mealTypes: ["lunch"],
  instructions: ["Grill chicken", "Toss salad"],
  ingredients: [
    { name: "Chicken breast", quantity: "2", unit: "pieces" },
    { name: "Mixed greens", quantity: "4", unit: "cups" },
  ],
  caloriesPerServing: "350",
  proteinPerServing: "40",
  carbsPerServing: "10",
  fatPerServing: "15",
  imageUrl: null,
  isPublic: true,
  likeCount: 5,
  remixedFromId: null,
  remixedFromTitle: null,
  createdAt: new Date("2024-05-01"),
  updatedAt: new Date("2024-05-01"),
};

// ────────────────────────────────────────────────────────────────────────────
// Normalizer tests
// ────────────────────────────────────────────────────────────────────────────

describe("mealPlanToSearchable", () => {
  it("converts a full recipe correctly", () => {
    const doc = mealPlanToSearchable(baseMealPlanRecipe, [
      "chicken",
      "mozzarella",
    ]);

    expect(doc.id).toBe("personal:1");
    expect(doc.source).toBe("personal");
    expect(doc.title).toBe("Chicken Parmesan");
    expect(doc.description).toBe("Classic Italian comfort food");
    expect(doc.cuisine).toBe("Italian");
    expect(doc.difficulty).toBe("Medium");
    expect(doc.dietTags).toEqual(["gluten free"]);
    expect(doc.mealTypes).toEqual(["dinner"]);
    expect(doc.ingredients).toEqual(["chicken", "mozzarella"]);
    expect(doc.caloriesPerServing).toBe(450);
    expect(doc.proteinPerServing).toBe(35);
    expect(doc.carbsPerServing).toBe(20);
    expect(doc.fatPerServing).toBe(25);
    expect(doc.prepTimeMinutes).toBe(15);
    expect(doc.cookTimeMinutes).toBe(30);
    expect(doc.totalTimeMinutes).toBe(45);
    expect(doc.servings).toBe(4);
    expect(doc.createdAt).toBe(new Date("2024-06-01").toISOString());
  });

  it("handles null numeric fields", () => {
    const recipe: MealPlanRecipe = {
      ...baseMealPlanRecipe,
      caloriesPerServing: null,
      proteinPerServing: null,
      carbsPerServing: null,
      fatPerServing: null,
      prepTimeMinutes: null,
      cookTimeMinutes: null,
    };

    const doc = mealPlanToSearchable(recipe, []);

    expect(doc.caloriesPerServing).toBeNull();
    expect(doc.proteinPerServing).toBeNull();
    expect(doc.carbsPerServing).toBeNull();
    expect(doc.fatPerServing).toBeNull();
    expect(doc.prepTimeMinutes).toBeNull();
    expect(doc.cookTimeMinutes).toBeNull();
    expect(doc.totalTimeMinutes).toBeNull();
  });

  it("calculates totalTimeMinutes from prep only when cook is null", () => {
    const recipe: MealPlanRecipe = {
      ...baseMealPlanRecipe,
      prepTimeMinutes: 10,
      cookTimeMinutes: null,
    };
    const doc = mealPlanToSearchable(recipe, []);
    expect(doc.totalTimeMinutes).toBe(10);
  });

  it("calculates totalTimeMinutes from cook only when prep is null", () => {
    const recipe: MealPlanRecipe = {
      ...baseMealPlanRecipe,
      prepTimeMinutes: null,
      cookTimeMinutes: 20,
    };
    const doc = mealPlanToSearchable(recipe, []);
    expect(doc.totalTimeMinutes).toBe(20);
  });
});

describe("communityToSearchable", () => {
  it("converts a full community recipe correctly", () => {
    const doc = communityToSearchable(baseCommunityRecipe);

    expect(doc.id).toBe("community:10");
    expect(doc.source).toBe("community");
    expect(doc.title).toBe("Grilled Chicken Salad");
    expect(doc.description).toBe("Healthy and fresh");
    expect(doc.difficulty).toBe("Easy");
    expect(doc.dietTags).toEqual(["vegetarian"]);
    expect(doc.ingredients).toEqual(["Chicken breast", "Mixed greens"]);
    expect(doc.createdAt).toBe(new Date("2024-05-01").toISOString());
  });

  it("maps nutrition columns and has null for time fields", () => {
    const doc = communityToSearchable(baseCommunityRecipe);

    expect(doc.cuisine).toBeNull();
    expect(doc.mealTypes).toEqual(["lunch"]);
    // baseCommunityRecipe now has real nutrition values (M22 — 2026-04-18)
    expect(doc.caloriesPerServing).toBe(350);
    expect(doc.proteinPerServing).toBe(40);
    expect(doc.carbsPerServing).toBe(10);
    expect(doc.fatPerServing).toBe(15);
    // Community recipes have no time columns — always null
    expect(doc.prepTimeMinutes).toBeNull();
    expect(doc.cookTimeMinutes).toBeNull();
    expect(doc.totalTimeMinutes).toBeNull();
  });

  it("has null nutrition when community recipe has no macros", () => {
    const noMacroRecipe: CommunityRecipe = {
      ...baseCommunityRecipe,
      caloriesPerServing: null,
      proteinPerServing: null,
      carbsPerServing: null,
      fatPerServing: null,
    };
    const doc = communityToSearchable(noMacroRecipe);
    expect(doc.caloriesPerServing).toBeNull();
    expect(doc.proteinPerServing).toBeNull();
    expect(doc.carbsPerServing).toBeNull();
    expect(doc.fatPerServing).toBeNull();
  });

  it("extracts ingredient names from JSONB array", () => {
    const recipe: CommunityRecipe = {
      ...baseCommunityRecipe,
      ingredients: [
        { name: "Tomato", quantity: "2", unit: "medium" },
        { name: "Basil", quantity: "1", unit: "tbsp" },
        { name: "Olive Oil", quantity: "2", unit: "tbsp" },
      ],
    };
    const doc = communityToSearchable(recipe);
    expect(doc.ingredients).toEqual(["Tomato", "Basil", "Olive Oil"]);
  });

  it("handles null/empty ingredients", () => {
    const recipe: CommunityRecipe = {
      ...baseCommunityRecipe,
      ingredients: null as unknown as [],
    };
    const doc = communityToSearchable(recipe);
    expect(doc.ingredients).toEqual([]);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// searchRecipes: basic text search
// ────────────────────────────────────────────────────────────────────────────

describe("searchRecipes — text search", () => {
  const mockedStorage = vi.mocked(storage);

  beforeEach(() => {
    resetSearchIndex();
    mockedStorage.getAllMealPlanRecipes.mockResolvedValue([baseMealPlanRecipe]);
    mockedStorage.getAllPublicCommunityRecipes.mockResolvedValue([
      baseCommunityRecipe,
    ]);
    mockedStorage.getAllRecipeIngredients.mockResolvedValue(
      new Map([
        [
          1,
          [
            {
              id: 1,
              recipeId: 1,
              name: "chicken",
              quantity: "1",
              unit: "lb",
              category: "protein",
              displayOrder: 0,
            },
          ],
        ],
      ]),
    );
  });

  it("returns matches for exact query", async () => {
    await initSearchIndex();
    const result = await searchRecipes({ q: "Chicken Parmesan" }, "user1");
    expect(result.results.length).toBeGreaterThan(0);
    const ids = result.results.map((r) => r.id);
    expect(ids).toContain("personal:1");
  });

  it("returns all recipes when no query", async () => {
    await initSearchIndex();
    const result = await searchRecipes({}, "user1");
    expect(result.results).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it("returns correct query metadata", async () => {
    await initSearchIndex();
    const result = await searchRecipes({ q: "chicken" }, "user1");
    expect(result.query.q).toBe("chicken");
    expect(result.offset).toBe(0);
    expect(result.limit).toBe(20);
  });

  it("performs fuzzy search — typo 'chiken'", async () => {
    await initSearchIndex();
    const result = await searchRecipes({ q: "chiken" }, "user1");
    expect(result.results.length).toBeGreaterThan(0);
    const ids = result.results.map((r) => r.id);
    expect(ids).toContain("personal:1");
  });

  it("performs prefix search — 'chic'", async () => {
    await initSearchIndex();
    const result = await searchRecipes({ q: "chic" }, "user1");
    expect(result.results.length).toBeGreaterThan(0);
  });

  it("returns empty results for non-matching query", async () => {
    await initSearchIndex();
    const result = await searchRecipes({ q: "xyznonexistentfood" }, "user1");
    expect(result.results).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it("concurrent initSearchIndex calls share a single in-flight load", async () => {
    // resetSearchIndex() is already called in beforeEach; no need to repeat it here.
    // Both callers start before initialized = true; without the init-promise
    // guard, both would call storage.* twice and addAll duplicate docs.
    const [a, b] = await Promise.all([initSearchIndex(), initSearchIndex()]);
    expect(a).toBeUndefined();
    expect(b).toBeUndefined();
    // Storage loaders should have been called exactly once across both racers.
    expect(mockedStorage.getAllMealPlanRecipes).toHaveBeenCalledTimes(1);
    expect(mockedStorage.getAllPublicCommunityRecipes).toHaveBeenCalledTimes(1);
    expect(mockedStorage.getAllRecipeIngredients).toHaveBeenCalledTimes(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// searchRecipes: filtering
// ────────────────────────────────────────────────────────────────────────────

describe("searchRecipes — filtering", () => {
  const mockedStorage = vi.mocked(storage);

  const veganRecipe: MealPlanRecipe = {
    ...baseMealPlanRecipe,
    id: 2,
    title: "Vegan Pasta",
    cuisine: "Italian",
    dietTags: ["vegan", "vegetarian"],
    difficulty: "Easy",
    prepTimeMinutes: 10,
    cookTimeMinutes: 5,
    caloriesPerServing: "300",
    proteinPerServing: "10",
    mealTypes: ["lunch"],
  };

  const hardRecipe: MealPlanRecipe = {
    ...baseMealPlanRecipe,
    id: 3,
    title: "Beef Wellington",
    cuisine: "British",
    dietTags: [],
    difficulty: "Hard",
    prepTimeMinutes: 60,
    cookTimeMinutes: 90,
    caloriesPerServing: "800",
    proteinPerServing: "50",
    mealTypes: ["dinner"],
  };

  beforeEach(() => {
    resetSearchIndex();
    mockedStorage.getAllMealPlanRecipes.mockResolvedValue([
      baseMealPlanRecipe,
      veganRecipe,
      hardRecipe,
    ]);
    mockedStorage.getAllPublicCommunityRecipes.mockResolvedValue([]);
    mockedStorage.getAllRecipeIngredients.mockResolvedValue(new Map());
  });

  it("filters by source=personal", async () => {
    await initSearchIndex();
    const result = await searchRecipes({ source: "personal" }, "user1");
    expect(result.results.every((r) => r.source === "personal")).toBe(true);
  });

  it("filters by source=community", async () => {
    resetSearchIndex();
    mockedStorage.getAllMealPlanRecipes.mockResolvedValue([]);
    mockedStorage.getAllPublicCommunityRecipes.mockResolvedValue([
      baseCommunityRecipe,
    ]);
    await initSearchIndex();
    const result = await searchRecipes({ source: "community" }, "user1");
    expect(result.results.every((r) => r.source === "community")).toBe(true);
  });

  it("filters by cuisine", async () => {
    await initSearchIndex();
    const result = await searchRecipes({ cuisine: "Italian" }, "user1");
    expect(result.results.length).toBeGreaterThan(0);
    result.results.forEach((r) => {
      const hasItalianCuisine = r.cuisine?.toLowerCase() === "italian";
      const hasItalianTag = r.dietTags.some(
        (t) => t.toLowerCase() === "italian",
      );
      expect(hasItalianCuisine || hasItalianTag).toBe(true);
    });
  });

  it("filters by diet tag", async () => {
    await initSearchIndex();
    const result = await searchRecipes({ diet: "vegan" }, "user1");
    expect(result.results.length).toBeGreaterThan(0);
    result.results.forEach((r) => {
      expect(r.dietTags.some((t) => t.toLowerCase() === "vegan")).toBe(true);
    });
  });

  it("filters by difficulty", async () => {
    await initSearchIndex();
    const result = await searchRecipes({ difficulty: "Easy" }, "user1");
    expect(result.results.length).toBeGreaterThan(0);
    result.results.forEach((r) => {
      expect(r.difficulty).toBe("Easy");
    });
  });

  it("filters by maxPrepTime", async () => {
    await initSearchIndex();
    const result = await searchRecipes({ maxPrepTime: 20 }, "user1");
    expect(result.results.length).toBeGreaterThan(0);
    result.results.forEach((r) => {
      if (r.prepTimeMinutes !== null) {
        expect(r.prepTimeMinutes).toBeLessThanOrEqual(20);
      }
    });
  });

  it("excludes recipes with null prepTimeMinutes when filtering by maxPrepTime", async () => {
    resetSearchIndex();
    const nullPrepRecipe: MealPlanRecipe = {
      ...baseMealPlanRecipe,
      id: 99,
      title: "Unknown Prep Time Recipe",
      prepTimeMinutes: null,
      cookTimeMinutes: null,
    };
    mockedStorage.getAllMealPlanRecipes.mockResolvedValue([nullPrepRecipe]);
    mockedStorage.getAllPublicCommunityRecipes.mockResolvedValue([]);
    await initSearchIndex();
    const result = await searchRecipes({ maxPrepTime: 10 }, "user1");
    const ids = result.results.map((r) => r.id);
    expect(ids).not.toContain("personal:99");
  });

  it("filters by maxCalories", async () => {
    await initSearchIndex();
    const result = await searchRecipes({ maxCalories: 400 }, "user1");
    result.results.forEach((r) => {
      if (r.caloriesPerServing !== null) {
        expect(r.caloriesPerServing).toBeLessThanOrEqual(400);
      }
    });
  });

  it("filters community recipes by maxCalories using real nutrition columns (M22 — 2026-04-18)", async () => {
    // Community recipes now have real per-serving nutrition columns.
    // baseCommunityRecipe has caloriesPerServing: "350".
    // maxCalories=100 should exclude it; maxCalories=400 should include it.
    resetSearchIndex();
    mockedStorage.getAllMealPlanRecipes.mockResolvedValue([]);
    mockedStorage.getAllPublicCommunityRecipes.mockResolvedValue([
      baseCommunityRecipe,
    ]);
    await initSearchIndex();

    const excludedResult = await searchRecipes({ maxCalories: 100 }, "user1");
    expect(excludedResult.results.map((r) => r.id)).not.toContain(
      "community:10",
    );

    const includedResult = await searchRecipes({ maxCalories: 400 }, "user1");
    expect(includedResult.results.map((r) => r.id)).toContain("community:10");
  });

  it("filters by minProtein", async () => {
    await initSearchIndex();
    const result = await searchRecipes({ minProtein: 40 }, "user1");
    result.results.forEach((r) => {
      if (r.proteinPerServing !== null) {
        expect(r.proteinPerServing).toBeGreaterThanOrEqual(40);
      }
    });
  });

  it("filters community recipes by minProtein using real nutrition columns (M22 — 2026-04-18)", async () => {
    // baseCommunityRecipe has proteinPerServing: "40".
    // minProtein=100 should exclude it; minProtein=30 should include it.
    resetSearchIndex();
    mockedStorage.getAllMealPlanRecipes.mockResolvedValue([]);
    mockedStorage.getAllPublicCommunityRecipes.mockResolvedValue([
      baseCommunityRecipe,
    ]);
    await initSearchIndex();

    const excludedResult = await searchRecipes({ minProtein: 100 }, "user1");
    expect(excludedResult.results.map((r) => r.id)).not.toContain(
      "community:10",
    );

    const includedResult = await searchRecipes({ minProtein: 30 }, "user1");
    expect(includedResult.results.map((r) => r.id)).toContain("community:10");
  });

  it("still excludes personal recipes with null calories under maxCalories", async () => {
    // Personal recipes are user-authored with well-formed nutrition — null
    // values there are a data defect, not a "we don't know" marker.
    resetSearchIndex();
    const nullCalRecipe: MealPlanRecipe = {
      ...baseMealPlanRecipe,
      id: 42,
      title: "Null Cal Recipe",
      caloriesPerServing: null,
    };
    mockedStorage.getAllMealPlanRecipes.mockResolvedValue([nullCalRecipe]);
    mockedStorage.getAllPublicCommunityRecipes.mockResolvedValue([]);
    await initSearchIndex();
    const result = await searchRecipes({ maxCalories: 100 }, "user1");
    const ids = result.results.map((r) => r.id);
    expect(ids).not.toContain("personal:42");
  });

  it("filters by mealType (includes when mealTypes empty)", async () => {
    resetSearchIndex();
    const noMealType: MealPlanRecipe = {
      ...baseMealPlanRecipe,
      id: 5,
      title: "Any Time Dish",
      mealTypes: [],
    };
    mockedStorage.getAllMealPlanRecipes.mockResolvedValue([
      baseMealPlanRecipe,
      noMealType,
    ]);
    mockedStorage.getAllPublicCommunityRecipes.mockResolvedValue([]);
    await initSearchIndex();
    const result = await searchRecipes({ mealType: "lunch" }, "user1");
    const ids = result.results.map((r) => r.id);
    // noMealType should be included (empty mealTypes = all meals)
    expect(ids).toContain("personal:5");
    // baseMealPlanRecipe has mealTypes: ["dinner"], should NOT be included
    expect(ids).not.toContain("personal:1");
  });

  it("applies combined filters", async () => {
    await initSearchIndex();
    const result = await searchRecipes(
      { cuisine: "Italian", difficulty: "Easy" },
      "user1",
    );
    result.results.forEach((r) => {
      const hasItalianCuisine = r.cuisine?.toLowerCase() === "italian";
      const hasItalianTag = r.dietTags.some(
        (t) => t.toLowerCase() === "italian",
      );
      expect(hasItalianCuisine || hasItalianTag).toBe(true);
      expect(r.difficulty).toBe("Easy");
    });
  });
});

// ────────────────────────────────────────────────────────────────────────────
// searchRecipes: sorting
// ────────────────────────────────────────────────────────────────────────────

describe("searchRecipes — sorting", () => {
  const mockedStorage = vi.mocked(storage);

  const olderRecipe: MealPlanRecipe = {
    ...baseMealPlanRecipe,
    id: 2,
    title: "Old Pasta",
    prepTimeMinutes: 5,
    cookTimeMinutes: 10,
    caloriesPerServing: "200",
    createdAt: new Date("2023-01-01"),
  };

  const newerRecipe: MealPlanRecipe = {
    ...baseMealPlanRecipe,
    id: 3,
    title: "New Stir Fry",
    prepTimeMinutes: 20,
    cookTimeMinutes: 10,
    caloriesPerServing: "600",
    createdAt: new Date("2024-12-01"),
  };

  beforeEach(() => {
    resetSearchIndex();
    mockedStorage.getAllMealPlanRecipes.mockResolvedValue([
      baseMealPlanRecipe,
      olderRecipe,
      newerRecipe,
    ]);
    mockedStorage.getAllPublicCommunityRecipes.mockResolvedValue([]);
    mockedStorage.getAllRecipeIngredients.mockResolvedValue(new Map());
  });

  it("sorts by newest (default when no q)", async () => {
    await initSearchIndex();
    const result = await searchRecipes({ sort: "newest" }, "user1");
    const dates = result.results.map((r) => new Date(r.createdAt!).getTime());
    for (let i = 1; i < dates.length; i++) {
      expect(dates[i - 1]).toBeGreaterThanOrEqual(dates[i]);
    }
  });

  it("sorts by quickest", async () => {
    await initSearchIndex();
    const result = await searchRecipes({ sort: "quickest" }, "user1");
    const times = result.results
      .map((r) => r.totalTimeMinutes)
      .filter((t): t is number => t !== null);
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1]).toBeLessThanOrEqual(times[i]);
    }
  });

  it("sorts by calories_asc", async () => {
    await initSearchIndex();
    const result = await searchRecipes({ sort: "calories_asc" }, "user1");
    const cals = result.results
      .map((r) => r.caloriesPerServing)
      .filter((c): c is number => c !== null);
    for (let i = 1; i < cals.length; i++) {
      expect(cals[i - 1]).toBeLessThanOrEqual(cals[i]);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// searchRecipes: pagination
// ────────────────────────────────────────────────────────────────────────────

describe("searchRecipes — pagination", () => {
  const mockedStorage = vi.mocked(storage);

  const recipes: MealPlanRecipe[] = Array.from({ length: 5 }, (_, i) => ({
    ...baseMealPlanRecipe,
    id: i + 1,
    title: `Recipe ${i + 1}`,
    createdAt: new Date(`2024-0${i + 1}-01`),
  }));

  beforeEach(() => {
    resetSearchIndex();
    mockedStorage.getAllMealPlanRecipes.mockResolvedValue(recipes);
    mockedStorage.getAllPublicCommunityRecipes.mockResolvedValue([]);
    mockedStorage.getAllRecipeIngredients.mockResolvedValue(new Map());
  });

  it("respects limit parameter", async () => {
    await initSearchIndex();
    const result = await searchRecipes({ limit: 2 }, "user1");
    expect(result.results).toHaveLength(2);
    expect(result.limit).toBe(2);
    expect(result.total).toBe(5);
  });

  it("respects offset parameter", async () => {
    await initSearchIndex();
    const pageOne = await searchRecipes({ limit: 2, offset: 0 }, "user1");
    const pageTwo = await searchRecipes({ limit: 2, offset: 2 }, "user1");
    const pageOneIds = pageOne.results.map((r) => r.id);
    const pageTwoIds = pageTwo.results.map((r) => r.id);
    expect(pageOneIds).not.toEqual(pageTwoIds);
    expect(pageTwo.offset).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// searchRecipes: ingredient search
// ────────────────────────────────────────────────────────────────────────────

describe("searchRecipes — ingredient search", () => {
  const mockedStorage = vi.mocked(storage);

  const chickenRecipe: MealPlanRecipe = {
    ...baseMealPlanRecipe,
    id: 1,
    title: "Chicken Stir Fry",
  };

  const tofuRecipe: MealPlanRecipe = {
    ...baseMealPlanRecipe,
    id: 2,
    title: "Tofu Scramble",
  };

  beforeEach(() => {
    resetSearchIndex();
    mockedStorage.getAllMealPlanRecipes.mockResolvedValue([
      chickenRecipe,
      tofuRecipe,
    ]);
    mockedStorage.getAllPublicCommunityRecipes.mockResolvedValue([]);
    mockedStorage.getAllRecipeIngredients.mockResolvedValue(
      new Map([
        [
          1,
          [
            {
              id: 1,
              recipeId: 1,
              name: "chicken breast",
              quantity: "1",
              unit: "lb",
              category: "protein",
              displayOrder: 0,
            },
          ],
        ],
        [
          2,
          [
            {
              id: 2,
              recipeId: 2,
              name: "firm tofu",
              quantity: "1",
              unit: "block",
              category: "protein",
              displayOrder: 0,
            },
          ],
        ],
      ]),
    );
  });

  it("filters by single ingredient", async () => {
    await initSearchIndex();
    const result = await searchRecipes({ ingredients: "chicken" }, "user1");
    expect(result.results.length).toBeGreaterThan(0);
    const ids = result.results.map((r) => r.id);
    expect(ids).toContain("personal:1");
    expect(ids).not.toContain("personal:2");
  });

  it("filters by multiple ingredients (comma-separated)", async () => {
    await initSearchIndex();
    const result = await searchRecipes(
      { ingredients: "chicken,breast" },
      "user1",
    );
    expect(result.results.length).toBeGreaterThan(0);
    const ids = result.results.map((r) => r.id);
    expect(ids).toContain("personal:1");
  });

  it("returns empty when no ingredient match", async () => {
    await initSearchIndex();
    const result = await searchRecipes({ ingredients: "salmon" }, "user1");
    expect(result.results).toHaveLength(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Index mutations: addToIndex / removeFromIndex
// ────────────────────────────────────────────────────────────────────────────

describe("addToIndex / removeFromIndex", () => {
  const mockedStorage = vi.mocked(storage);

  beforeEach(() => {
    resetSearchIndex();
    mockedStorage.getAllMealPlanRecipes.mockResolvedValue([]);
    mockedStorage.getAllPublicCommunityRecipes.mockResolvedValue([]);
    mockedStorage.getAllRecipeIngredients.mockResolvedValue(new Map());
  });

  it("addToIndex makes a recipe searchable", async () => {
    await initSearchIndex();
    const doc = mealPlanToSearchable(baseMealPlanRecipe, [
      "chicken",
      "parmesan",
    ]);
    addToIndex(doc);

    const result = await searchRecipes({ q: "Parmesan" }, "user1");
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].id).toBe("personal:1");
  });

  it("addToIndex updates an existing document", async () => {
    await initSearchIndex();
    const doc = mealPlanToSearchable(baseMealPlanRecipe, ["chicken"]);
    addToIndex(doc);

    const updated = { ...doc, title: "Chicken Marsala" };
    addToIndex(updated);

    const result = await searchRecipes({ q: "Marsala" }, "user1");
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.results[0].title).toBe("Chicken Marsala");
  });

  it("removeFromIndex removes the document", async () => {
    await initSearchIndex();
    const doc = mealPlanToSearchable(baseMealPlanRecipe, ["chicken"]);
    addToIndex(doc);
    removeFromIndex(doc.id);

    const result = await searchRecipes({ q: "Chicken Parmesan" }, "user1");
    const ids = result.results.map((r) => r.id);
    expect(ids).not.toContain("personal:1");
  });
});
