import {
  findNutrient,
  mapToMealPlanRecipe,
  recipeDetailSchema,
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
  });
});
