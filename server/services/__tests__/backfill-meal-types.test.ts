import { describe, it, expect, vi, beforeEach } from "vitest";

import { storage } from "../../storage";
import { backfillMealTypes } from "../meal-type-inference";

vi.mock("../../storage", () => ({
  storage: {
    getRecipesWithEmptyMealTypes: vi.fn(),
    batchUpdateMealTypes: vi.fn(),
  },
}));

describe("backfillMealTypes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 0 and does not call batchUpdateMealTypes when there are no recipes to backfill", async () => {
    vi.mocked(storage.getRecipesWithEmptyMealTypes).mockResolvedValue({
      recipes: [],
      ingredientsByRecipe: new Map(),
    });

    const count = await backfillMealTypes();

    expect(count).toBe(0);
    expect(storage.batchUpdateMealTypes).not.toHaveBeenCalled();
  });

  it("infers meal types from recipe title and calls batchUpdateMealTypes", async () => {
    const recipes = [
      { id: 1, title: "Chicken Pasta" },
      { id: 2, title: "Morning Oatmeal" },
    ];
    vi.mocked(storage.getRecipesWithEmptyMealTypes).mockResolvedValue({
      recipes,
      ingredientsByRecipe: new Map(),
    });
    vi.mocked(storage.batchUpdateMealTypes).mockResolvedValue(2);

    const count = await backfillMealTypes();

    expect(count).toBe(2);
    const updates = vi.mocked(storage.batchUpdateMealTypes).mock.calls[0][0];
    expect(updates).toHaveLength(2);

    const pastaUpdate = updates.find((u) => u.id === 1);
    expect(pastaUpdate?.mealTypes).toContain("dinner");

    const oatmealUpdate = updates.find((u) => u.id === 2);
    expect(oatmealUpdate?.mealTypes).toContain("breakfast");
  });

  it("tags unclassified recipes with the 'unclassified' sentinel", async () => {
    const recipes = [{ id: 3, title: "Mystery Dish XyzAbc" }];
    vi.mocked(storage.getRecipesWithEmptyMealTypes).mockResolvedValue({
      recipes,
      ingredientsByRecipe: new Map(),
    });
    vi.mocked(storage.batchUpdateMealTypes).mockResolvedValue(1);

    await backfillMealTypes();

    const updates = vi.mocked(storage.batchUpdateMealTypes).mock.calls[0][0];
    expect(updates[0].mealTypes).toEqual(["unclassified"]);
  });

  it("uses ingredient names when provided to improve inference", async () => {
    const recipes = [{ id: 4, title: "Veggie Dish" }];
    const ingredientsByRecipe = new Map([[4, ["eggs", "cheese"]]]);
    vi.mocked(storage.getRecipesWithEmptyMealTypes).mockResolvedValue({
      recipes,
      ingredientsByRecipe,
    });
    vi.mocked(storage.batchUpdateMealTypes).mockResolvedValue(1);

    await backfillMealTypes();

    const updates = vi.mocked(storage.batchUpdateMealTypes).mock.calls[0][0];
    // "eggs" is a breakfast keyword → inferred as breakfast
    expect(updates[0].mealTypes).toContain("breakfast");
  });
});
