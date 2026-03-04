import { describe, it, expect, vi, afterEach } from "vitest";
import {
  findNutrient,
  mapToMealPlanRecipe,
  recipeDetailSchema,
  clearDetailCache,
  CatalogQuotaError,
} from "../recipe-catalog";
import { z } from "zod";

type RecipeDetail = z.infer<typeof recipeDetailSchema>;

describe("Recipe Catalog", () => {
  describe("recipeDetailSchema", () => {
    it("validates a complete Spoonacular response", () => {
      const data = {
        id: 123,
        title: "Test Recipe",
        image: "https://example.com/img.jpg",
        readyInMinutes: 30,
        preparationMinutes: 10,
        cookingMinutes: 20,
        servings: 4,
        sourceUrl: "https://example.com/recipe",
        summary: "<p>A great recipe</p>",
        instructions: "<ol><li>Step 1</li></ol>",
        cuisines: ["Italian"],
        diets: ["vegetarian", "gluten free"],
        extendedIngredients: [
          { id: 1, name: "flour", amount: 2, unit: "cups" },
          { id: 2, name: "sugar", amount: 1, unit: "cup" },
        ],
        nutrition: {
          nutrients: [
            { name: "Calories", amount: 350, unit: "kcal" },
            { name: "Protein", amount: 12, unit: "g" },
            { name: "Carbohydrates", amount: 45, unit: "g" },
            { name: "Fat", amount: 15, unit: "g" },
          ],
        },
      };

      const result = recipeDetailSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("validates minimal response", () => {
      const data = { id: 1, title: "Simple" };
      const result = recipeDetailSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it("handles null preparationMinutes and cookingMinutes", () => {
      const data = {
        id: 1,
        title: "Test",
        preparationMinutes: null,
        cookingMinutes: null,
      };
      const result = recipeDetailSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.preparationMinutes).toBeNull();
        expect(result.data.cookingMinutes).toBeNull();
      }
    });

    it("rejects missing title", () => {
      const data = { id: 1 };
      const result = recipeDetailSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe("findNutrient", () => {
    const nutrients = [
      { name: "Calories", amount: 350, unit: "kcal" },
      { name: "Protein", amount: 12, unit: "g" },
      { name: "Carbohydrates", amount: 45, unit: "g" },
      { name: "Fat", amount: 15, unit: "g" },
      { name: "Fiber", amount: 3, unit: "g" },
    ];

    it("finds nutrient by name (case-insensitive)", () => {
      expect(findNutrient(nutrients, "Calories")).toBe(350);
      expect(findNutrient(nutrients, "calories")).toBe(350);
      expect(findNutrient(nutrients, "protein")).toBe(12);
    });

    it("returns null for missing nutrient", () => {
      expect(findNutrient(nutrients, "Sodium")).toBeNull();
    });

    it("handles empty array", () => {
      expect(findNutrient([], "Calories")).toBeNull();
    });
  });

  describe("mapToMealPlanRecipe", () => {
    const fullDetail: RecipeDetail = {
      id: 123,
      title: "Pasta Primavera",
      image: "https://img.example.com/pasta.jpg",
      readyInMinutes: 30,
      preparationMinutes: 10,
      cookingMinutes: 20,
      servings: 4,
      sourceUrl: "https://example.com/pasta",
      summary: "<p>A classic <b>Italian</b> pasta dish</p>",
      instructions: "<p>Boil water. Cook pasta.</p>",
      cuisines: ["Italian", "Mediterranean"],
      diets: ["vegetarian"],
      extendedIngredients: [
        { id: 1, name: "penne pasta", amount: 12, unit: "oz" },
        { id: 2, name: "olive oil", amount: 2, unit: "tbsp" },
      ],
      nutrition: {
        nutrients: [
          { name: "Calories", amount: 320, unit: "kcal" },
          { name: "Protein", amount: 10, unit: "g" },
          { name: "Carbohydrates", amount: 52, unit: "g" },
          { name: "Fat", amount: 8, unit: "g" },
          { name: "Fiber", amount: 4, unit: "g" },
          { name: "Sugar", amount: 5, unit: "g" },
          { name: "Sodium", amount: 400, unit: "mg" },
        ],
      },
    };

    it("maps recipe data correctly", () => {
      const { recipe } = mapToMealPlanRecipe(fullDetail, "user-1");

      expect(recipe.userId).toBe("user-1");
      expect(recipe.title).toBe("Pasta Primavera");
      expect(recipe.sourceType).toBe("catalog");
      expect(recipe.externalId).toBe("123");
      expect(recipe.cuisine).toBe("Italian");
      expect(recipe.servings).toBe(4);
      expect(recipe.prepTimeMinutes).toBe(10);
      expect(recipe.cookTimeMinutes).toBe(20);
      expect(recipe.imageUrl).toBe("https://img.example.com/pasta.jpg");
      expect(recipe.dietTags).toEqual(["vegetarian"]);
    });

    it("strips HTML from summary", () => {
      const { recipe } = mapToMealPlanRecipe(fullDetail, "user-1");
      expect(recipe.description).not.toContain("<");
      expect(recipe.description).toContain("Italian");
    });

    it("strips HTML from instructions", () => {
      const { recipe } = mapToMealPlanRecipe(fullDetail, "user-1");
      expect(recipe.instructions).not.toContain("<");
      expect(recipe.instructions).toContain("Boil water");
    });

    it("extracts nutrition values", () => {
      const { recipe } = mapToMealPlanRecipe(fullDetail, "user-1");
      expect(recipe.caloriesPerServing).toBe("320");
      expect(recipe.proteinPerServing).toBe("10");
      expect(recipe.carbsPerServing).toBe("52");
      expect(recipe.fatPerServing).toBe("8");
      expect(recipe.fiberPerServing).toBe("4");
      expect(recipe.sugarPerServing).toBe("5");
      expect(recipe.sodiumPerServing).toBe("400");
    });

    it("maps ingredients correctly", () => {
      const { ingredients } = mapToMealPlanRecipe(fullDetail, "user-1");

      expect(ingredients).toHaveLength(2);
      expect(ingredients[0].name).toBe("penne pasta");
      expect(ingredients[0].quantity).toBe("12");
      expect(ingredients[0].unit).toBe("oz");
      expect(ingredients[0].displayOrder).toBe(0);
      expect(ingredients[1].displayOrder).toBe(1);
    });

    it("handles missing optional fields", () => {
      const minimal: RecipeDetail = {
        id: 456,
        title: "Simple Recipe",
      };

      const { recipe, ingredients } = mapToMealPlanRecipe(minimal, "user-1");

      expect(recipe.title).toBe("Simple Recipe");
      expect(recipe.description).toBeNull();
      expect(recipe.cuisine).toBeNull();
      expect(recipe.prepTimeMinutes).toBeNull();
      expect(recipe.cookTimeMinutes).toBeNull();
      expect(recipe.caloriesPerServing).toBeNull();
      expect(recipe.dietTags).toEqual([]);
      expect(ingredients).toHaveLength(0);
    });

    it("handles missing nutrition object", () => {
      const noNutrition: RecipeDetail = {
        id: 789,
        title: "No Nutrition",
        servings: 2,
      };

      const { recipe } = mapToMealPlanRecipe(noNutrition, "user-1");
      expect(recipe.caloriesPerServing).toBeNull();
      expect(recipe.proteinPerServing).toBeNull();
    });

    it("truncates long summaries to 2000 chars", () => {
      const longSummary = "x".repeat(3000);
      const detail: RecipeDetail = {
        id: 1,
        title: "Long",
        summary: longSummary,
      };
      const { recipe } = mapToMealPlanRecipe(detail, "user-1");
      expect(recipe.description!.length).toBeLessThanOrEqual(2000);
    });

    it("handles ingredients with missing amount and unit", () => {
      const detail: RecipeDetail = {
        id: 1,
        title: "Sparse",
        extendedIngredients: [
          { name: "salt" },
          { name: "pepper", amount: undefined, unit: undefined },
        ],
      };
      const { ingredients } = mapToMealPlanRecipe(detail, "user-1");
      expect(ingredients).toHaveLength(2);
      expect(ingredients[0].quantity).toBeNull();
      expect(ingredients[0].unit).toBeNull();
      expect(ingredients[1].quantity).toBeNull();
    });

    it("defaults servings to 2 when not provided", () => {
      const detail: RecipeDetail = { id: 1, title: "No Servings" };
      const { recipe } = mapToMealPlanRecipe(detail, "user-1");
      expect(recipe.servings).toBe(2);
    });
  });

  describe("CatalogQuotaError", () => {
    it("is an instance of Error", () => {
      const err = new CatalogQuotaError("quota exceeded");
      expect(err).toBeInstanceOf(Error);
      expect(err.name).toBe("CatalogQuotaError");
      expect(err.message).toBe("quota exceeded");
    });
  });

  describe("clearDetailCache", () => {
    it("executes without error", () => {
      expect(() => clearDetailCache()).not.toThrow();
    });
  });

  describe("searchCatalogRecipes (with API key)", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.resetModules();
      delete process.env.SPOONACULAR_API_KEY;
    });

    async function importWithKey() {
      vi.resetModules();
      process.env.SPOONACULAR_API_KEY = "test-key";
      return await import("../recipe-catalog");
    }

    it("returns empty results when no API key is set", async () => {
      // Re-import the module without an API key so the top-level capture
      // of process.env.SPOONACULAR_API_KEY is undefined.
      vi.resetModules();
      delete process.env.SPOONACULAR_API_KEY;
      const mod = await import("../recipe-catalog");
      const result = await mod.searchCatalogRecipes({ query: "pasta" });
      expect(result.results).toEqual([]);
      expect(result.totalResults).toBe(0);
    });

    it("returns null from getCatalogRecipeDetail when no API key", async () => {
      vi.resetModules();
      delete process.env.SPOONACULAR_API_KEY;
      const mod = await import("../recipe-catalog");
      const result = await mod.getCatalogRecipeDetail(123);
      expect(result).toBeNull();
    });

    it("returns parsed results on successful API response", async () => {
      const mockResponse = {
        results: [
          { id: 1, title: "Pasta", image: "img.jpg", readyInMinutes: 20 },
          { id: 2, title: "Salad", readyInMinutes: 10 },
        ],
        offset: 0,
        number: 10,
        totalResults: 2,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
      });

      const mod = await importWithKey();
      const result = await mod.searchCatalogRecipes({ query: "pasta" });
      expect(result.results).toHaveLength(2);
      expect(result.results[0].title).toBe("Pasta");
      expect(result.totalResults).toBe(2);
    });

    it("throws CatalogQuotaError on 402 response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 402,
      });

      const mod = await importWithKey();
      await expect(
        mod.searchCatalogRecipes({ query: "pasta" }),
      ).rejects.toThrow(mod.CatalogQuotaError);
    });

    it("throws generic error on non-ok response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      const mod = await importWithKey();
      await expect(
        mod.searchCatalogRecipes({ query: "pasta" }),
      ).rejects.toThrow("Spoonacular search failed: 500");
    });

    it("returns empty results on parse failure", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ invalid: "data" }),
      });

      const mod = await importWithKey();
      const result = await mod.searchCatalogRecipes({ query: "pasta" });
      expect(result.results).toEqual([]);
      expect(result.totalResults).toBe(0);
    });

    it("passes optional parameters to URL", async () => {
      const mockResponse = {
        results: [],
        offset: 0,
        number: 5,
        totalResults: 0,
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockResponse),
      });

      const mod = await importWithKey();
      await mod.searchCatalogRecipes({
        query: "soup",
        cuisine: "Italian",
        diet: "vegetarian",
        type: "main course",
        maxReadyTime: 30,
        offset: 10,
        number: 5,
      });

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
        .calls[0];
      const url = fetchCall[0] as string;
      expect(url).toContain("cuisine=Italian");
      expect(url).toContain("diet=vegetarian");
      expect(url).toContain("type=main+course");
      expect(url).toContain("maxReadyTime=30");
      expect(url).toContain("offset=10");
      expect(url).toContain("number=5");
    });
  });

  describe("getCatalogRecipeDetail (with API key)", () => {
    const originalFetch = globalThis.fetch;

    afterEach(() => {
      globalThis.fetch = originalFetch;
      vi.resetModules();
      delete process.env.SPOONACULAR_API_KEY;
    });

    async function importWithKey() {
      vi.resetModules();
      process.env.SPOONACULAR_API_KEY = "test-key";
      return await import("../recipe-catalog");
    }

    it("fetches and caches recipe detail", async () => {
      const mockDetail = {
        id: 100,
        title: "Cached Recipe",
        servings: 4,
        nutrition: {
          nutrients: [{ name: "Calories", amount: 300, unit: "kcal" }],
        },
      };

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockDetail),
      });

      const mod = await importWithKey();
      // First call fetches
      const result1 = await mod.getCatalogRecipeDetail(100);
      expect(result1).not.toBeNull();
      expect(result1!.recipe.title).toBe("Cached Recipe");
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      // Second call uses cache
      const result2 = await mod.getCatalogRecipeDetail(100);
      expect(result2).not.toBeNull();
      expect(result2!.recipe.title).toBe("Cached Recipe");
      expect(globalThis.fetch).toHaveBeenCalledTimes(1); // no additional fetch
    });

    it("throws CatalogQuotaError on 402 response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 402,
      });

      const mod = await importWithKey();
      await expect(mod.getCatalogRecipeDetail(999)).rejects.toThrow(
        mod.CatalogQuotaError,
      );
    });

    it("throws error on non-ok response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      });

      const mod = await importWithKey();
      await expect(mod.getCatalogRecipeDetail(999)).rejects.toThrow(
        "Spoonacular detail failed: 503",
      );
    });

    it("returns null on parse failure", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ bad: "data" }),
      });

      const mod = await importWithKey();
      const result = await mod.getCatalogRecipeDetail(999);
      expect(result).toBeNull();
    });
  });
});
