import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getToolDefinitions,
  executeToolCall,
  MAX_TOOL_CALLS_PER_RESPONSE,
} from "../coach-tools";
import { storage } from "../../storage";

vi.mock("../../storage", () => ({
  storage: {
    getDailyLogs: vi.fn().mockResolvedValue([]),
    getDailySummary: vi
      .fn()
      .mockResolvedValue({ totalCalories: 800, totalProtein: 60 }),
    getPantryItems: vi.fn().mockResolvedValue([]),
    getExpiringPantryItems: vi.fn().mockResolvedValue([]),
    getMealPlanItems: vi.fn().mockResolvedValue([]),
    addMealPlanItem: vi.fn().mockResolvedValue({ id: 1 }),
    addGroceryListItems: vi.fn().mockResolvedValue([{ id: 1 }]),
    createGroceryListWithLimitCheck: vi
      .fn()
      .mockResolvedValue({ list: { id: 1 }, items: [{ id: 1 }] }),
    getGroceryLists: vi.fn().mockResolvedValue({ lists: [], total: 0 }),
    createScannedItemWithLog: vi.fn().mockResolvedValue({ id: 42 }),
    // M2: search_recipes now fetches user profile for allergen intolerances
    getUserProfile: vi.fn().mockResolvedValue(null),
  },
}));

vi.mock("../nutrition-lookup", () => ({
  lookupNutrition: vi.fn().mockResolvedValue({
    name: "chicken",
    calories: 165,
    protein: 31,
    carbs: 0,
    fat: 3.6,
    fiber: 0,
    sugar: 0,
    sodium: 74,
    servingSize: "100g",
    source: "USDA",
  }),
}));

vi.mock("../recipe-catalog", () => ({
  searchCatalogRecipes: vi.fn().mockResolvedValue({
    results: [
      { id: 1, title: "Test Recipe", image: "url", readyInMinutes: 30 },
    ],
  }),
}));

vi.mock("../../lib/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe("Coach Tools Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 9 tool definitions", () => {
    const tools = getToolDefinitions();
    expect(tools).toHaveLength(9);
  });

  it("each tool has name, description, and parameters", () => {
    const tools = getToolDefinitions();
    for (const tool of tools) {
      expect(tool).toHaveProperty("type", "function");
      const fn = (tool as unknown as { function: Record<string, unknown> })
        .function;
      expect(fn).toHaveProperty("name");
      expect(fn).toHaveProperty("description");
      expect(fn).toHaveProperty("parameters");
    }
  });

  it("tool names match expected set", () => {
    const tools = getToolDefinitions();
    const names = tools.map(
      (t) => (t as { function: { name: string } }).function.name,
    );
    expect(names).toContain("lookup_nutrition");
    expect(names).toContain("search_recipes");
    expect(names).toContain("get_daily_log_details");
    expect(names).toContain("log_food_item");
    expect(names).toContain("get_pantry_items");
    expect(names).toContain("get_meal_plan");
    expect(names).toContain("add_to_meal_plan");
    expect(names).toContain("add_to_grocery_list");
    expect(names).toContain("get_substitutions");
  });

  it("executes lookup_nutrition tool", async () => {
    const result = await executeToolCall(
      "lookup_nutrition",
      { query: "chicken breast" },
      "user-1",
    );
    expect(result).toHaveProperty("name", "chicken");
  });

  it("executes get_daily_log_details tool", async () => {
    const result = await executeToolCall("get_daily_log_details", {}, "user-1");
    expect(result).toHaveProperty("totals");
  });

  it("rejects invalid get_daily_log_details dates", async () => {
    const result = await executeToolCall(
      "get_daily_log_details",
      { date: "2026-02-30" },
      "user-1",
    );

    expect(result).toMatchObject({
      error: true,
      code: "INVALID_ARGS",
    });
    expect(storage.getDailyLogs).not.toHaveBeenCalled();
  });

  it("rejects get_meal_plan ranges over the tool cap", async () => {
    const result = await executeToolCall(
      "get_meal_plan",
      { startDate: "2026-04-01", endDate: "2026-04-30" },
      "user-1",
    );

    expect(result).toMatchObject({
      error: true,
      code: "INVALID_ARGS",
      message: expect.stringContaining("14 days"),
    });
    expect(storage.getMealPlanItems).not.toHaveBeenCalled();
  });

  it("returns compact get_meal_plan items", async () => {
    vi.mocked(storage.getMealPlanItems).mockResolvedValueOnce([
      {
        id: 1,
        userId: "user-1",
        recipeId: 10,
        scannedItemId: null,
        plannedDate: "2026-04-29",
        mealType: "dinner",
        servings: "1",
        sortOrder: 0,
        createdAt: new Date(),
        recipe: {
          id: 10,
          userId: "user-1",
          title: "Compact Recipe",
          description: "Large description should not be returned",
          cuisine: null,
          sourceType: "user_created",
          sourceUrl: null,
          externalId: null,
          imageUrl: null,
          servings: 2,
          caloriesPerServing: "400",
          proteinPerServing: "30",
          carbsPerServing: "40",
          fatPerServing: "15",
          fiberPerServing: null,
          sugarPerServing: null,
          sodiumPerServing: null,
          prepTimeMinutes: null,
          cookTimeMinutes: null,
          difficulty: null,
          instructions: ["large", "instruction", "payload"],
          dietTags: [],
          mealTypes: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        scannedItem: null,
      },
    ] as Awaited<ReturnType<typeof storage.getMealPlanItems>>);

    const result = (await executeToolCall(
      "get_meal_plan",
      { startDate: "2026-04-29", endDate: "2026-04-29" },
      "user-1",
    )) as { items: { recipe: Record<string, unknown> }[] };

    expect(result.items[0].recipe).toEqual({
      id: 10,
      title: "Compact Recipe",
      caloriesPerServing: "400",
      proteinPerServing: "30",
      carbsPerServing: "40",
      fatPerServing: "15",
    });
    expect(result.items[0].recipe).not.toHaveProperty("instructions");
  });

  it("returns schema-aligned log food proposal actions", async () => {
    const result = await executeToolCall(
      "log_food_item",
      { name: "Greek yogurt", calories: 180, protein: 18, carbs: 10, fat: 4 },
      "user-1",
    );

    expect(result).toMatchObject({
      proposal: true,
      action: {
        type: "log_food",
        description: "Greek yogurt",
        calories: 180,
        protein: 18,
        carbs: 10,
        fat: 4,
      },
    });
  });

  it("returns schema-aligned navigation proposal actions", async () => {
    const mealPlanResult = await executeToolCall(
      "add_to_meal_plan",
      { plannedDate: "2026-04-29", mealType: "dinner" },
      "user-1",
    );
    const groceryResult = await executeToolCall(
      "add_to_grocery_list",
      { items: [{ name: "oats" }] },
      "user-1",
    );

    expect(mealPlanResult).toMatchObject({
      proposal: true,
      action: {
        type: "navigate",
        screen: "RecipeBrowserModal",
        params: { date: "2026-04-29", mealType: "dinner" },
      },
    });
    expect(groceryResult).toMatchObject({
      proposal: true,
      action: { type: "navigate", screen: "GroceryListsModal" },
    });
  });

  it("executes search_recipes tool", async () => {
    const result = (await executeToolCall(
      "search_recipes",
      { query: "healthy lunch" },
      "user-1",
    )) as { results: unknown[] };
    expect(result.results).toHaveLength(1);
  });

  it("rejects unknown tool name", async () => {
    await expect(executeToolCall("unknown_tool", {}, "user-1")).rejects.toThrow(
      "Unknown tool",
    );
  });

  it("exports MAX_TOOL_CALLS_PER_RESPONSE as 5", () => {
    expect(MAX_TOOL_CALLS_PER_RESPONSE).toBe(5);
  });

  describe("structured error returns", () => {
    it("returns INVALID_ARGS error for empty lookup_nutrition query", async () => {
      const result = await executeToolCall(
        "lookup_nutrition",
        { query: "" },
        "user1",
      );
      expect(result).toMatchObject({
        error: true,
        code: "INVALID_ARGS",
        message: expect.stringContaining("lookup_nutrition"),
      });
    });

    it("returns NOT_FOUND error when nutrition lookup returns null", async () => {
      const { lookupNutrition } = await import("../nutrition-lookup");
      vi.mocked(lookupNutrition).mockResolvedValueOnce(null);
      const result = await executeToolCall(
        "lookup_nutrition",
        { query: "imaginary food" },
        "user1",
      );
      expect(result).toMatchObject({
        error: true,
        code: "NOT_FOUND",
        message: expect.stringContaining("imaginary food"),
      });
    });

    it("returns INVALID_ARGS error for empty search_recipes query", async () => {
      const result = await executeToolCall(
        "search_recipes",
        { query: "" },
        "user1",
      );
      expect(result).toMatchObject({
        error: true,
        code: "INVALID_ARGS",
        message: expect.stringContaining("search_recipes"),
      });
    });

    it("returns INVALID_ARGS error for log_food_item with missing name", async () => {
      const result = await executeToolCall(
        "log_food_item",
        { calories: 100 },
        "user1",
      );
      expect(result).toMatchObject({
        error: true,
        code: "INVALID_ARGS",
      });
    });
  });
});
