import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  getToolDefinitions,
  executeToolCall,
  MAX_TOOL_CALLS_PER_RESPONSE,
} from "../coach-tools";

vi.mock("../../storage", () => ({
  storage: {
    getDailyLogs: vi.fn().mockResolvedValue([]),
    getDailySummary: vi.fn().mockResolvedValue({ totalCalories: 800, totalProtein: 60 }),
    getPantryItems: vi.fn().mockResolvedValue([]),
    getExpiringPantryItems: vi.fn().mockResolvedValue([]),
    getMealPlanItems: vi.fn().mockResolvedValue([]),
    addMealPlanItem: vi.fn().mockResolvedValue({ id: 1 }),
    addGroceryListItems: vi.fn().mockResolvedValue([{ id: 1 }]),
    createGroceryListWithLimitCheck: vi.fn().mockResolvedValue({ list: { id: 1 }, items: [{ id: 1 }] }),
    getGroceryLists: vi.fn().mockResolvedValue({ lists: [], total: 0 }),
    createScannedItemWithLog: vi.fn().mockResolvedValue({ id: 42 }),
  },
}));

vi.mock("../nutrition-lookup", () => ({
  lookupNutrition: vi.fn().mockResolvedValue({ name: "chicken", calories: 165, protein: 31, carbs: 0, fat: 3.6, fiber: 0, sugar: 0, sodium: 74, servingSize: "100g", source: "USDA" }),
}));

vi.mock("../recipe-catalog", () => ({
  searchCatalogRecipes: vi.fn().mockResolvedValue({ results: [{ id: 1, title: "Test Recipe", image: "url", readyInMinutes: 30 }] }),
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
      const fn = (tool as unknown as { function: Record<string, unknown> }).function;
      expect(fn).toHaveProperty("name");
      expect(fn).toHaveProperty("description");
      expect(fn).toHaveProperty("parameters");
    }
  });

  it("tool names match expected set", () => {
    const tools = getToolDefinitions();
    const names = tools.map((t) => (t as { function: { name: string } }).function.name);
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
    const result = await executeToolCall("lookup_nutrition", { query: "chicken breast" }, "user-1");
    expect(result).toHaveProperty("name", "chicken");
  });

  it("executes get_daily_log_details tool", async () => {
    const result = await executeToolCall("get_daily_log_details", {}, "user-1");
    expect(result).toHaveProperty("totals");
  });

  it("executes search_recipes tool", async () => {
    const result = await executeToolCall("search_recipes", { query: "healthy lunch" }, "user-1") as { results: unknown[] };
    expect(result.results).toHaveLength(1);
  });

  it("rejects unknown tool name", async () => {
    await expect(executeToolCall("unknown_tool", {}, "user-1")).rejects.toThrow("Unknown tool");
  });

  it("exports MAX_TOOL_CALLS_PER_RESPONSE as 5", () => {
    expect(MAX_TOOL_CALLS_PER_RESPONSE).toBe(5);
  });
});
