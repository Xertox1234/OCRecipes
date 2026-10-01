import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SearchableRecipe } from "@shared/types/recipe-search";
import {
  findCommunity,
  selectCloseMatches,
  communityQueryText,
  toFinderItem,
} from "../find-community";
import { searchRecipes, initSearchIndex } from "../../recipe-search";
import { isIndexInitialized } from "../../../lib/search-index";

vi.mock("../../recipe-search", () => ({
  searchRecipes: vi.fn(),
  initSearchIndex: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../lib/search-index", () => ({
  isIndexInitialized: vi.fn().mockReturnValue(true),
}));
vi.mock("../../../lib/fire-and-forget", () => ({
  fireAndForget: vi.fn((_l: string, p: Promise<unknown>) => {
    p.catch(() => {});
  }),
}));

function recipe(
  id: number,
  title: string,
  overrides: Partial<SearchableRecipe> = {},
): SearchableRecipe {
  return {
    id: `community:${id}`,
    source: "community",
    userId: null,
    title,
    description: null,
    ingredients: ["x"],
    cuisine: null,
    dietTags: [],
    mealTypes: [],
    difficulty: null,
    prepTimeMinutes: null,
    cookTimeMinutes: null,
    totalTimeMinutes: null,
    caloriesPerServing: 350.4,
    proteinPerServing: null,
    carbsPerServing: null,
    fatPerServing: null,
    servings: 2,
    imageUrl: null,
    sourceUrl: null,
    createdAt: null,
    isCanonical: false,
    allergens: [],
    ...overrides,
  };
}

function searchReturns(hits: [SearchableRecipe, number][]) {
  vi.mocked(searchRecipes).mockResolvedValueOnce({
    results: hits.map(([r]) => r),
    total: hits.length,
    offset: 0,
    limit: 25,
    query: { q: "x", filters: {}, sort: "relevance" },
    scores: Object.fromEntries(hits.map(([r, s]) => [r.id, s])),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isIndexInitialized).mockReturnValue(true);
});

describe("selectCloseMatches", () => {
  const hits = [
    { recipe: recipe(1, "A"), score: 20 },
    { recipe: recipe(2, "B"), score: 12 },
    { recipe: recipe(3, "C"), score: 9 },
    { recipe: recipe(4, "D"), score: 3 },
  ];

  it("keeps hits at or above relative × best, capped at max", () => {
    const out = selectCloseMatches(hits, { relative: 0.5, floor: 0, max: 5 });
    expect(out.map((h) => h.score)).toEqual([20, 12]);
  });

  it("applies the absolute floor so a lone weak hit is not shown", () => {
    expect(
      selectCloseMatches([{ recipe: recipe(9, "Z"), score: 2 }], {
        relative: 0.5,
        floor: 4,
        max: 5,
      }),
    ).toEqual([]);
  });

  it("returns [] for no hits", () => {
    expect(selectCloseMatches([], { relative: 0.5, floor: 0, max: 5 })).toEqual(
      [],
    );
  });
});

describe("communityQueryText", () => {
  it("puts cuisine into q (community rows have cuisine null — R3)", () => {
    expect(
      communityQueryText({ q: "quinoa salad", cuisine: "mediterranean" }),
    ).toBe("mediterranean quinoa salad");
  });
});

describe("toFinderItem", () => {
  it("maps id, rounds calories, and leaves time null for community rows", () => {
    expect(toFinderItem(recipe(12, "Salad"))).toEqual({
      id: 12,
      source: "community",
      title: "Salad",
      imageUrl: null,
      readyInMinutes: null,
      calories: 350,
    });
  });
});

describe("findCommunity", () => {
  it("never sends maxPrepTime or a cuisine filter, and asks for scores", async () => {
    searchReturns([[recipe(1, "Mediterranean Quinoa Salad"), 20]]);
    await findCommunity(
      { q: "quinoa salad", cuisine: "mediterranean", maxPrepTime: 20 },
      "u1",
      [],
    );
    const [params, userId, opts] = vi.mocked(searchRecipes).mock.calls[0];
    expect(params).toMatchObject({
      q: "mediterranean quinoa salad",
      source: "community",
      safeForMe: true,
    });
    expect(params).not.toHaveProperty("maxPrepTime");
    expect(params).not.toHaveProperty("cuisine");
    expect(userId).toBe("u1");
    expect(opts).toEqual({ includeScores: true });
  });

  it("maps the finder's diet vocabulary onto community tag spellings", async () => {
    for (const [diet, tag] of [
      ["ketogenic", "keto"],
      ["gluten free", "gluten-free"],
      ["Dairy Free", "dairy-free"],
      ["vegan", "vegan"],
    ]) {
      vi.mocked(searchRecipes).mockReset();
      searchReturns([[recipe(1, "Bowl"), 20]]);
      await findCommunity({ q: "bowl", diet }, "u1", []);
      expect(vi.mocked(searchRecipes).mock.calls[0][0]).toMatchObject({
        diet: tag,
      });
    }
  });

  it("the retry drops mealType but keeps a stated diet", async () => {
    searchReturns([]);
    searchReturns([[recipe(5, "Vegan Chili"), 15]]);
    const items = await findCommunity(
      { q: "chili", diet: "vegan", mealType: "dinner" },
      "u1",
      [],
    );
    expect(vi.mocked(searchRecipes)).toHaveBeenCalledTimes(2);
    const retry = vi.mocked(searchRecipes).mock.calls[1][0];
    expect(retry).toMatchObject({
      q: "chili",
      diet: "vegan",
      safeForMe: true,
      source: "community",
    });
    expect(retry).not.toHaveProperty("mealType");
    expect(items.map((i) => i.id)).toEqual([5]);
  });

  it("a diet with no diet-safe hit is no matches — never a retry without the diet", async () => {
    searchReturns([]);
    searchReturns([[recipe(6, "Creamy Tomato Pasta"), 30]]);
    const items = await findCommunity({ q: "pasta", diet: "vegan" }, "u1", []);
    expect(vi.mocked(searchRecipes)).toHaveBeenCalledTimes(1);
    expect(items).toEqual([]);
  });

  it("with no diet, the retry is q-only", async () => {
    searchReturns([]);
    searchReturns([[recipe(7, "Omelette"), 15]]);
    const items = await findCommunity(
      { q: "omelette", mealType: "breakfast" },
      "u1",
      [],
    );
    const retry = vi.mocked(searchRecipes).mock.calls[1][0];
    expect(retry).not.toHaveProperty("mealType");
    expect(retry).not.toHaveProperty("diet");
    expect(items.map((i) => i.id)).toEqual([7]);
  });

  it("a request that is only a diet and a meal type browses by the filters (no text, no score cut)", async () => {
    // Filter-only hits score 0 — the close-match floor must not drop them.
    searchReturns([
      [recipe(3, "Keto Salmon"), 0],
      [recipe(7, "Keto Steak"), 0],
    ]);
    const items = await findCommunity(
      { q: "dinner", diet: "ketogenic", mealType: "dinner" },
      "u1",
      [],
    );
    const params = vi.mocked(searchRecipes).mock.calls[0][0];
    expect(params).not.toHaveProperty("q");
    expect(params).toMatchObject({ diet: "keto", mealType: "dinner" });
    expect(items.map((i) => i.id)).toEqual([3, 7]);
  });

  it("browsing caps the list at FINDER_MAX_ITEMS", async () => {
    searchReturns([1, 2, 3, 4, 5, 6, 7].map((id) => [recipe(id, `R${id}`), 0]));
    const items = await findCommunity(
      { q: "gluten free dinner", diet: "gluten free", mealType: "dinner" },
      "u1",
      [],
    );
    expect(vi.mocked(searchRecipes).mock.calls[0][0]).not.toHaveProperty("q");
    expect(items).toHaveLength(5);
  });

  it("a bare meal type with no diet still searches the text (no browse)", async () => {
    searchReturns([[recipe(21, "Sunday Dinner Roast"), 12]]);
    await findCommunity({ q: "dinner", mealType: "dinner" }, "u1", []);
    expect(vi.mocked(searchRecipes).mock.calls[0][0]).toMatchObject({
      q: "dinner",
    });
  });

  it("excludes already-shown ids", async () => {
    searchReturns([
      [recipe(1, "A"), 20],
      [recipe(2, "B"), 19],
    ]);
    const items = await findCommunity({ q: "a" }, "u1", ["community:1"]);
    expect(items.map((i) => i.id)).toEqual([2]);
  });

  it("treats a not-ready index as 0 matches and starts the build (§6)", async () => {
    vi.mocked(isIndexInitialized).mockReturnValue(false);
    await expect(findCommunity({ q: "a" }, "u1", [])).resolves.toEqual([]);
    expect(searchRecipes).not.toHaveBeenCalled();
    expect(initSearchIndex).toHaveBeenCalled();
  });

  it("returns [] when the search throws", async () => {
    vi.mocked(searchRecipes).mockRejectedValueOnce(new Error("db down"));
    await expect(findCommunity({ q: "a" }, "u1", [])).resolves.toEqual([]);
  });
});
